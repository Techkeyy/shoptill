export interface Markup { inline_keyboard: ({ text: string; web_app?: { url: string }; callback_data?: string })[][] }

export interface Update {
  update_id: number;
  message?: { message_id: number; chat: { id: number; type: string }; from?: { id: number }; text?: string };
  callback_query?: { id: string; from: { id: number }; data?: string; message?: { chat: { id: number }; message_id: number } };
}

export interface Tg {
  me(): Promise<{ username: string }>;
  send(chat: number, text: string, markup?: Markup): Promise<number>;
  edit(chat: number, messageId: number, text: string, markup?: Markup): Promise<void>;
  photo(chat: number, png: Uint8Array, caption: string): Promise<void>;
  answerCb(id: string, text?: string): Promise<void>;
  getUpdates(offset: number, timeoutSec: number): Promise<Update[]>;
  /** Command menu, description and about text (optional: fakes skip it). */
  configure?(p: { commands: { command: string; description: string }[]; description: string; short: string }): Promise<void>;
}

/** Raw Bot API over fetch. The token never appears in logs (errors carry only the method name + description). */
export class BotApi implements Tg {
  constructor(private token: string) {}

  private async call(method: string, body?: unknown, form?: FormData, signal?: AbortSignal): Promise<any> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: form ? undefined : { 'content-type': 'application/json' },
      body: form ?? JSON.stringify(body ?? {}),
      signal,
    });
    const j: any = await res.json().catch(() => ({}));
    if (!j.ok) throw new Error(`telegram ${method}: ${j.description ?? res.status}`);
    return j.result;
  }

  async me() { return this.call('getMe'); }
  async send(chat: number, text: string, markup?: Markup) {
    const r = await this.call('sendMessage', { chat_id: chat, text, reply_markup: markup });
    return r.message_id as number;
  }
  async edit(chat: number, messageId: number, text: string, markup?: Markup) {
    try {
      await this.call('editMessageText', { chat_id: chat, message_id: messageId, text, reply_markup: markup ?? { inline_keyboard: [] } });
    } catch (e) {
      if (!String((e as Error).message).includes('not modified')) throw e;
    }
  }
  async photo(chat: number, png: Uint8Array, caption: string) {
    const f = new FormData();
    f.set('chat_id', String(chat));
    f.set('caption', caption);
    f.set('photo', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'counter-qr.png');
    await this.call('sendPhoto', undefined, f);
  }
  async configure(p: { commands: { command: string; description: string }[]; description: string; short: string }) {
    await this.call('setMyCommands', { commands: p.commands });
    await this.call('setMyDescription', { description: p.description });
    await this.call('setMyShortDescription', { short_description: p.short });
    await this.call('setChatMenuButton', { menu_button: { type: 'commands' } });
  }
  async answerCb(id: string, text?: string) { await this.call('answerCallbackQuery', { callback_query_id: id, text }); }
  async getUpdates(offset: number, timeoutSec: number): Promise<Update[]> {
    return this.call('getUpdates', { offset, timeout: timeoutSec, allowed_updates: ['message', 'callback_query'] },
      undefined, AbortSignal.timeout((timeoutSec + 15) * 1000));
  }
}
