import { contextBridge, ipcRenderer, webUtils } from "electron";
import { isChannel, isEvent, type AnurBridge } from "../shared/ipc-contract.ts";

/**
 * The only door between the page and the rest of Anur: `window.anur.call`
 * for channels in the contract, and `window.anur.on` for its events. Main
 * checks every request again; this check only stops a typo from reaching it.
 */
const bridge: AnurBridge = {
  call(channel, request) {
    if (!isChannel(channel)) return Promise.reject(new Error(`unknown channel ${String(channel)}`));
    return ipcRenderer.invoke(channel, request) as never;
  },
  on(event, listener) {
    if (!isEvent(event)) throw new Error(`unknown event ${String(event)}`);
    const wrapped = (_e: unknown, payload: unknown) => {
      listener(payload as never);
    };
    ipcRenderer.on(event, wrapped);
    return () => {
      ipcRenderer.removeListener(event, wrapped);
    };
  },
  pathOf(file) {
    return webUtils.getPathForFile(file);
  },
};

contextBridge.exposeInMainWorld("anur", bridge);
