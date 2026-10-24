// @effect-diagnostics-next-line nodeBuiltinImport:off - Effect Crypto does not parse X.509 certificates.
import * as NodeCrypto from "node:crypto";
import {
  DesktopClientCertificatePreferenceSchema,
  type DesktopClientCertificatePreference,
} from "@t3tools/contracts";
import * as Electron from "electron";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as SynchronizedRef from "effect/SynchronizedRef";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";

const PreferencesJson = Schema.fromJsonString(
  Schema.Array(DesktopClientCertificatePreferenceSchema),
);
const decodePreferencesJson = Schema.decodeUnknownEffect(PreferencesJson);
const encodePreferencesJson = Schema.encodeEffect(PreferencesJson);

export class DesktopClientCertificateError extends Schema.TaggedError<DesktopClientCertificateError>()(
  "DesktopClientCertificateError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    const detail = this.cause instanceof Error ? ` ${this.cause.message}` : "";
    return `Client certificate ${this.operation} failed.${detail}`;
  }
}
const isDesktopClientCertificateError = Schema.is(DesktopClientCertificateError);

/** Scope HTTPS/WSS URLs and Electron's TLS host:port callbacks to one origin. */
export function clientCertificateOrigin(value: string): string | null {
  try {
    // Electron emits HostPortPair::ToString(), including brackets around IPv6.
    const endpoint = /^(?:\[[\da-f:]+\]|[^:/?#@\s]+):\d+$/iu.test(value)
      ? `https://${value}`
      : value;
    const url = new URL(endpoint);
    if (url.username || url.password) return null;
    if (url.protocol === "wss:") url.protocol = "https:";
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function preferenceFor(origin: string, certificate: Electron.Certificate) {
  return {
    origin,
    fingerprint: new NodeCrypto.X509Certificate(certificate.data).fingerprint256,
    subjectName: certificate.subjectName,
    issuerName: certificate.issuerName,
    validExpiry: certificate.validExpiry,
  } satisfies DesktopClientCertificatePreference;
}

export class DesktopClientCertificates extends Context.Service<
  DesktopClientCertificates,
  {
    readonly list: Effect.Effect<readonly DesktopClientCertificatePreference[]>;
    readonly forget: (origin: string) => Effect.Effect<void, DesktopClientCertificateError>;
    readonly prepare: (
      url: string,
    ) => Effect.Effect<DesktopClientCertificatePreference | null, DesktopClientCertificateError>;
    readonly select: (
      url: string,
      certificates: readonly Electron.Certificate[],
    ) => Effect.Effect<Electron.Certificate | undefined, DesktopClientCertificateError>;
    readonly register: Effect.Effect<void, never, Scope.Scope>;
  }
>()("@t3tools/desktop/certificates/DesktopClientCertificates") {}

/** Stores only public certificate identities; private keys remain in the platform store. */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const crypto = yield* Crypto.Crypto;
  const app = yield* ElectronApp.ElectronApp;
  const dialog = yield* ElectronDialog.ElectronDialog;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const settingsPath = environment.path.join(environment.stateDir, "client-certificates.json");
  const initial = yield* fileSystem.readFileString(settingsPath).pipe(
    Effect.flatMap(decodePreferencesJson),
    Effect.catchTags({
      PlatformError: (error) =>
        error.reason._tag === "NotFound"
          ? Effect.succeed([])
          : Effect.fail(new DesktopClientCertificateError({ operation: "read", cause: error })),
      SchemaError: (cause) =>
        Effect.fail(new DesktopClientCertificateError({ operation: "read", cause })),
    }),
  );
  const preferences =
    yield* SynchronizedRef.make<readonly DesktopClientCertificatePreference[]>(initial);
  const promptGate = yield* Semaphore.make(1);

  const update = (
    f: (
      current: readonly DesktopClientCertificatePreference[],
    ) => readonly DesktopClientCertificatePreference[],
  ) =>
    SynchronizedRef.updateEffect(preferences, (current) =>
      Effect.gen(function* () {
        const next = f(current);
        const encoded = yield* encodePreferencesJson(next);
        const suffix = yield* crypto.randomUUIDv4();
        const temporaryPath = `${settingsPath}.${suffix}.tmp`;
        yield* fileSystem.makeDirectory(environment.stateDir, { recursive: true });
        yield* fileSystem.writeFileString(temporaryPath, `${encoded}\n`);
        yield* fileSystem
          .rename(temporaryPath, settingsPath)
          .pipe(Effect.onError(() => fileSystem.remove(temporaryPath).pipe(Effect.ignore)));
        return next;
      }).pipe(
        Effect.mapError((cause) => new DesktopClientCertificateError({ operation: "save", cause })),
      ),
    );

  const select = Effect.fn("DesktopClientCertificates.select")(
    function* (url: string, certificates: readonly Electron.Certificate[]) {
      const origin = clientCertificateOrigin(url);
      if (origin === null) return undefined;
      const candidates = yield* Effect.try({
        try: () =>
          certificates.map((certificate) => ({
            certificate,
            preference: preferenceFor(origin, certificate),
          })),
        catch: (cause) => new DesktopClientCertificateError({ operation: "read identity", cause }),
      });
      const saved = (yield* SynchronizedRef.get(preferences)).find(
        (item) => item.origin === origin,
      );
      const matching = candidates.find(
        (item) => item.preference.fingerprint === saved?.fingerprint,
      );
      if (matching) return matching.certificate;

      if (candidates.length === 0) {
        yield* dialog.showMessageBox({
          type: "info",
          title: "Client certificate required",
          message: `${origin} requested a client certificate, but no matching certificates are installed.`,
          detail:
            "Import your .p12 or .pfx into your Windows personal certificate store or Linux NSS certificate database, then restart T3 Code.",
          buttons: ["OK"],
        });
        return undefined;
      }

      const result = yield* dialog.showMessageBox({
        type: "question",
        title: "Choose a client certificate",
        message: `Choose the certificate T3 Code should use for ${origin}`,
        detail: [
          ...(saved ? ["The previously selected certificate is no longer available.", ""] : []),
          ...candidates.map(
            ({ preference }, index) =>
              `${index + 1}. ${preference.subjectName}\nIssuer: ${preference.issuerName}\nExpires: ${DateTime.formatIsoDateUtc(DateTime.makeUnsafe(preference.validExpiry * 1000))}\nSHA-256: ${preference.fingerprint}`,
          ),
        ].join("\n\n"),
        buttons: [
          "Cancel",
          ...candidates.map(
            ({ preference }, index) =>
              `${index + 1}. ${preference.subjectName || "Unnamed certificate"}`,
          ),
        ],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        checkboxLabel: "Remember for this server in T3 Code",
        checkboxChecked: true,
      });
      const selected = candidates[result.response - 1];
      if (!selected) return undefined;
      if (result.checkboxChecked) {
        yield* update((current) => [
          ...current.filter((item) => item.origin !== origin),
          selected.preference,
        ]);
      }
      return selected.certificate;
    },
    (effect) =>
      effect.pipe(
        Effect.mapError((cause) =>
          isDesktopClientCertificateError(cause)
            ? cause
            : new DesktopClientCertificateError({ operation: "selection", cause }),
        ),
        promptGate.withPermit,
      ),
  );

  return DesktopClientCertificates.of({
    list: SynchronizedRef.get(preferences),
    forget: (origin) => update((current) => current.filter((item) => item.origin !== origin)),
    prepare: Effect.fn("DesktopClientCertificates.prepare")(function* (url) {
      const origin = clientCertificateOrigin(url);
      if (origin === null) {
        return yield* new DesktopClientCertificateError({
          operation: "setup (enter an HTTPS server address)",
          cause: "Invalid HTTPS origin",
        });
      }
      // Complete TLS with Chromium's certificate store before any T3 discovery or
      // pairing request. HEAD needs no T3 session and never redeems a pairing code.
      // HTTP errors still prove TLS succeeded; redirects must not select for another host.
      yield* Effect.tryPromise({
        try: (signal) =>
          Electron.net.fetch(`${origin}/`, {
            method: "HEAD",
            // Client certificates are TLS credentials, so explicitly allow them.
            credentials: "include",
            redirect: "manual",
            signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
          }),
        catch: (cause) =>
          new DesktopClientCertificateError({
            operation: "setup",
            cause,
          }),
      }).pipe(
        // Electron rejects manual redirects after TLS has already succeeded.
        // Keep the original endpoint's choice without following the new address.
        Effect.catch((error) =>
          error.cause instanceof Error && error.cause.message === "Redirect was cancelled"
            ? Effect.void
            : Effect.fail(error),
        ),
      );
      return (
        (yield* SynchronizedRef.get(preferences)).find((item) => item.origin === origin) ?? null
      );
    }),
    select,
    register: app.on(
      "select-client-certificate",
      (
        event: Electron.Event,
        _webContents: Electron.WebContents | null,
        url: string,
        certificates: Electron.Certificate[],
        callback: (certificate?: Electron.Certificate) => void,
      ) => {
        // Electron otherwise silently presents the first matching platform certificate.
        event.preventDefault();
        void runPromise(
          select(url, certificates).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Client certificate selection failed.", cause).pipe(
                Effect.as(undefined),
              ),
            ),
          ),
        ).then(callback);
      },
    ),
  });
});

export const layer = Layer.effect(DesktopClientCertificates, make);
