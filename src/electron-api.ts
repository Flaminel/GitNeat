import { bridgeApi } from "./bridge-api";

const bridge = window.gitneatBridge;

if (bridge) {
  window.gitneat = bridgeApi({
    invoke: (name, args) => bridge.invoke(name, args ?? {}) as never,
    listen: (event, fn) => bridge.listen(event, fn as (payload: unknown) => void),
    setZoom: (factor) => bridge.setZoom(factor),
    toggleFullscreen: () => bridge.toggleFullscreen(),
    windowAction: (action) => bridge.windowAction(action),
  });
}
