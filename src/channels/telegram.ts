/**
 * Telegram channel adapter (v2) — uses Chat SDK bridge, with a pairing
 * interceptor wrapped around onInbound to verify chat ownership before
 * registration. See telegram-pairing.ts for the why.
 *
 * Pool support: set TELEGRAM_BOT_POOL to a comma-separated list of additional
 * bot tokens. All pool tokens plus TELEGRAM_BOT_TOKEN are run concurrently
 * under a single 'telegram' adapter. Inbound messages record which token
 * handled each platformId; delivery is routed back to that same token.
 */
import { createTelegramAdapter } from '@chat-adapter/telegram';

import { readEnvFile } from '../env.js';
import { log } from '../log.js';
import { createMessagingGroup, getMessagingGroupByPlatform, updateMessagingGroup } from '../db/messaging-groups.js';
import { grantRole, hasAnyOwner } from '../modules/permissions/db/user-roles.js';
import { upsertUser } from '../modules/permissions/db/users.js';
import { createChatSdkBridge, type ReplyContext } from './chat-sdk-bridge.js';
import { sanitizeTelegramLegacyMarkdown } from './telegram-markdown-sanitize.js';
import { registerChannelAdapter } from './channel-registry.js';
import type { ChannelAdapter, ChannelSetup, InboundMessage, OutboundMessage } from './adapter.js';
import { tryConsume } from './telegram-pairing.js';

/**
 * Retry a one-shot operation that can fail on transient network errors at
 * cold-start (DNS hiccups, brief upstream outages). Exponential backoff capped
 * at 5 attempts — if the network is truly down we surface it instead of
 * hanging the service indefinitely.
 */
async function withRetry<T>(fn: () => Promise<T>, label: string, maxAttempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      const delay = Math.min(16000, 1000 * 2 ** (attempt - 1));
      log.warn('Telegram setup failed, retrying', { label, attempt, delayMs: delay, err });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractReplyContext(raw: Record<string, any>): ReplyContext | null {
  if (!raw.reply_to_message) return null;
  const reply = raw.reply_to_message;
  return {
    text: reply.text || reply.caption || '',
    sender: reply.from?.first_name || reply.from?.username || 'Unknown',
  };
}

/** Look up the bot username via Telegram getMe. Cached after first call. */
async function fetchBotUsername(token: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const json = (await res.json()) as { ok: boolean; result?: { username?: string } };
    return json.ok ? (json.result?.username ?? null) : null;
  } catch (err) {
    log.warn('Telegram getMe failed', { err });
    return null;
  }
}

function isGroupPlatformId(platformId: string): boolean {
  // platformId is "telegram:<chatId>". Negative chat IDs are groups/channels.
  const id = platformId.split(':').pop() ?? '';
  return id.startsWith('-');
}

interface InboundFields {
  text: string;
  authorUserId: string | null;
}

function readInboundFields(message: InboundMessage): InboundFields {
  if (message.kind !== 'chat-sdk' || !message.content || typeof message.content !== 'object') {
    return { text: '', authorUserId: null };
  }
  const c = message.content as { text?: string; author?: { userId?: string } };
  return { text: c.text ?? '', authorUserId: c.author?.userId ?? null };
}

/**
 * Build an onInbound interceptor that consumes pairing codes before they
 * reach the router. On match: records the chat + its paired user, promotes
 * the user to owner if the instance has no owner yet, and short-circuits.
 * On miss: forwards to the host.
 */
/**
 * Send a one-shot confirmation back to the paired chat. Best-effort — failures
 * are logged but never propagated, so a Telegram outage can't undo a successful
 * pairing or trigger the interceptor's fail-open path.
 */
async function sendPairingConfirmation(token: string, platformId: string): Promise<void> {
  const chatId = platformId.split(':').slice(1).join(':');
  if (!chatId) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: "Pairing success! I'm spinning up the agent now, you'll get a message from them shortly.",
      }),
    });
    if (!res.ok) {
      log.warn('Telegram pairing confirmation non-OK', { status: res.status });
    }
  } catch (err) {
    log.warn('Telegram pairing confirmation failed', { err });
  }
}

function createPairingInterceptor(
  botUsernamePromise: Promise<string | null>,
  hostOnInbound: ChannelSetup['onInbound'],
  token: string,
): ChannelSetup['onInbound'] {
  return async (platformId, threadId, message) => {
    try {
      const botUsername = await botUsernamePromise;
      if (!botUsername) {
        hostOnInbound(platformId, threadId, message);
        return;
      }
      const { text, authorUserId } = readInboundFields(message);
      if (!text) {
        hostOnInbound(platformId, threadId, message);
        return;
      }
      const consumed = await tryConsume({
        text,
        botUsername,
        platformId,
        isGroup: isGroupPlatformId(platformId),
        adminUserId: authorUserId,
      });
      if (!consumed) {
        hostOnInbound(platformId, threadId, message);
        return;
      }
      // Pairing matched — record the chat and short-circuit so the
      // code-bearing message never reaches an agent. Privilege is now a
      // property of the paired user, not the chat: upsert the user, and if
      // this instance has no owner yet, promote them to owner.
      const existing = getMessagingGroupByPlatform('telegram', platformId);
      if (existing) {
        updateMessagingGroup(existing.id, {
          is_group: consumed.consumed!.isGroup ? 1 : 0,
        });
      } else {
        createMessagingGroup({
          id: `mg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          channel_type: 'telegram',
          platform_id: platformId,
          name: consumed.consumed!.name,
          is_group: consumed.consumed!.isGroup ? 1 : 0,
          unknown_sender_policy: 'strict',
          created_at: new Date().toISOString(),
        });
      }

      const pairedUserId = `telegram:${consumed.consumed!.adminUserId}`;
      upsertUser({
        id: pairedUserId,
        kind: 'telegram',
        display_name: null,
        created_at: new Date().toISOString(),
      });

      let promotedToOwner = false;
      if (!hasAnyOwner()) {
        grantRole({
          user_id: pairedUserId,
          role: 'owner',
          agent_group_id: null,
          granted_by: null,
          granted_at: new Date().toISOString(),
        });
        promotedToOwner = true;
      }

      log.info('Telegram pairing accepted — chat registered', {
        platformId,
        pairedUser: pairedUserId,
        promotedToOwner,
        intent: consumed.intent,
      });

      await sendPairingConfirmation(token, platformId);
    } catch (err) {
      log.error('Telegram pairing interceptor error', { err });
      // Fail open: pass through so a pairing bug doesn't break normal traffic.
      hostOnInbound(platformId, threadId, message);
    }
  };
}

/**
 * Parse bot tokens from env vars into a deduped, ordered list.
 * Primary token (TELEGRAM_BOT_TOKEN) is always first.
 * TELEGRAM_BOT_POOL is a comma-separated list of additional tokens.
 * Exported for testing.
 */
export function parseTokenPool(env: Record<string, string>): string[] {
  const primary = env.TELEGRAM_BOT_TOKEN ?? '';
  const poolStr = env.TELEGRAM_BOT_POOL ?? '';
  const poolTokens = poolStr
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const all = [primary, ...poolTokens].filter(Boolean);
  // Dedupe preserving order
  const seen = new Set<string>();
  return all.filter((t) => {
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
}

/** Build a single-token ChannelAdapter. Used for both the solo and pool cases. */
function buildSingleBotAdapter(token: string): ChannelAdapter {
  const telegramAdapter = createTelegramAdapter({
    botToken: token,
    mode: 'polling',
  });
  const bridge = createChatSdkBridge({
    adapter: telegramAdapter,
    concurrency: 'concurrent',
    extractReplyContext,
    supportsThreads: false,
    transformOutboundText: sanitizeTelegramLegacyMarkdown,
  });

  const botUsernamePromise = fetchBotUsername(token);

  return {
    ...bridge,
    async setup(hostConfig: ChannelSetup) {
      const intercepted: ChannelSetup = {
        ...hostConfig,
        onInbound: createPairingInterceptor(botUsernamePromise, hostConfig.onInbound, token),
      };
      return withRetry(() => bridge.setup(intercepted), `bridge.setup[${token.slice(0, 8)}]`);
    },
  };
}

/**
 * Build a pool adapter that wraps multiple single-bot adapters.
 *
 * Inbound: each sub-adapter records which token index handled each platformId.
 * Deliver: routes to the sub-adapter that handled that platformId, with
 *   index-0 as the fallback for platformIds not yet seen (e.g. host-initiated DMs).
 */
function buildPoolAdapter(tokens: string[]): ChannelAdapter {
  const subAdapters = tokens.map(buildSingleBotAdapter);

  // platformId → index into subAdapters / tokens (populated on first inbound)
  const platformTokenIdx = new Map<string, number>();

  function adapterFor(platformId: string): ChannelAdapter {
    const idx = platformTokenIdx.get(platformId) ?? 0;
    return subAdapters[idx]!;
  }

  return {
    name: 'telegram',
    channelType: 'telegram',
    supportsThreads: false,

    async setup(hostConfig: ChannelSetup): Promise<void> {
      await Promise.all(
        subAdapters.map((sub, idx) => {
          const wrapped: ChannelSetup = {
            ...hostConfig,
            onInbound(platformId: string, threadId: string | null, message: InboundMessage) {
              // Record which sub-adapter first saw this platformId so we can
              // deliver back via the correct bot.
              if (!platformTokenIdx.has(platformId)) {
                platformTokenIdx.set(platformId, idx);
                log.debug('Telegram pool: mapped platformId to token', {
                  platformId,
                  tokenIndex: idx,
                  tokenPrefix: tokens[idx]!.slice(0, 8),
                });
              }
              return hostConfig.onInbound(platformId, threadId, message);
            },
          };
          return sub.setup(wrapped);
        }),
      );
      log.info('Telegram pool adapter started', { tokenCount: tokens.length });
    },

    async teardown(): Promise<void> {
      await Promise.all(subAdapters.map((s) => s.teardown()));
    },

    isConnected(): boolean {
      return subAdapters.some((s) => s.isConnected());
    },

    async deliver(platformId: string, threadId: string | null, message: OutboundMessage): Promise<string | undefined> {
      return adapterFor(platformId).deliver(platformId, threadId, message);
    },

    async setTyping(platformId: string, threadId: string | null): Promise<void> {
      return adapterFor(platformId).setTyping?.(platformId, threadId);
    },

    async subscribe(platformId: string, threadId: string): Promise<void> {
      return adapterFor(platformId).subscribe?.(platformId, threadId);
    },

    async syncConversations() {
      const results = await Promise.all(subAdapters.map((s) => s.syncConversations?.() ?? Promise.resolve([])));
      return results.flat();
    },
  };
}

registerChannelAdapter('telegram', {
  factory: () => {
    const env = readEnvFile(['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_POOL']);
    const tokens = parseTokenPool(env);
    if (tokens.length === 0) return null;
    if (tokens.length === 1) return buildSingleBotAdapter(tokens[0]!);
    return buildPoolAdapter(tokens);
  },
});
