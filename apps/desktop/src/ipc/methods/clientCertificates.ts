import { DesktopClientCertificatePreferenceSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopClientCertificates from "../../certificates/DesktopClientCertificates.ts";
import * as DesktopLifecycle from "../../app/DesktopLifecycle.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const getClientCertificates = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_CLIENT_CERTIFICATES_CHANNEL,
  payload: Schema.Void,
  result: Schema.Array(DesktopClientCertificatePreferenceSchema),
  handler: Effect.fn("desktop.ipc.clientCertificates.list")(function* () {
    return yield* (yield* DesktopClientCertificates.DesktopClientCertificates).list;
  }),
});

export const forgetClientCertificate = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FORGET_CLIENT_CERTIFICATE_CHANNEL,
  payload: Schema.String,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.clientCertificates.forget")(function* (origin) {
    const certificates = yield* DesktopClientCertificates.DesktopClientCertificates;
    yield* certificates.forget(origin);
    // Chromium caches client certificate choices and live TLS sessions until restart.
    const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
    yield* lifecycle.relaunch("client certificate forgotten");
  }),
});
