import { ipcContract, type Channel, type Request, type Response } from "../shared/ipc-contract.ts";

/** The parts of an IPC event main needs to decide whether to trust it. */
export type SenderInfo = { webContentsId: number; frameUrl: string | null };

export type Handler<C extends Channel> = (
  request: Request<C>,
) => Response<C> | Promise<Response<C>>;

export class IpcRefused extends Error {}

/**
 * Wrap a handler so it runs only for a trusted sender and a request that
 * matches its schema, and only ever returns a response that matches too.
 * Kept free of Electron so it can be tested on its own.
 */
export function guarded<C extends Channel>(
  channel: C,
  handler: Handler<C>,
  isTrusted: (sender: SenderInfo) => boolean,
): (sender: SenderInfo, raw: unknown) => Promise<Response<C>> {
  const { request, response } = ipcContract[channel];
  return async (sender, raw) => {
    if (!isTrusted(sender))
      throw new IpcRefused(`${channel}: refused, the sender is not an Anur window`);
    const parsed = request.safeParse(raw);
    if (!parsed.success)
      throw new IpcRefused(`${channel}: refused, the request doesn't match its schema`);
    const result = await handler(parsed.data as Request<C>);
    return response.parse(result) as Response<C>;
  };
}

/** A sender is trusted when it is one of our windows showing our own page. */
export function trustedSenders(rendererUrl: () => string) {
  const ids = new Set<number>();
  return {
    add(id: number) {
      ids.add(id);
    },
    remove(id: number) {
      ids.delete(id);
    },
    isTrusted(sender: SenderInfo): boolean {
      if (!ids.has(sender.webContentsId) || !sender.frameUrl) return false;
      const want = new URL(rendererUrl());
      const got = new URL(sender.frameUrl);
      return (
        got.protocol === want.protocol && got.host === want.host && got.pathname === want.pathname
      );
    },
  };
}
