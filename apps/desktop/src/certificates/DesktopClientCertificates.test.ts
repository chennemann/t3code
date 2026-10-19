// @effect-diagnostics-next-line nodeBuiltinImport:off - Verify the fingerprint of a real X.509 certificate.
import * as NodeCrypto from "node:crypto";
import * as NodeEvents from "node:events";
import * as NodeTls from "node:tls";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { vi } from "vite-plus/test";

const { netFetch } = vi.hoisted(() => ({ netFetch: vi.fn() }));
vi.mock("electron", () => ({ net: { fetch: netFetch } }));

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import { clientCertificateOrigin, make } from "./DesktopClientCertificates.ts";

// Public PEMs exercise identity matching without storing private test keys.
const certificates = NodeTls.rootCertificates.slice(0, 2).map(
  (data, index) =>
    ({
      data,
      subjectName: `Laptop ${index + 1}`,
      issuerName: "Test issuer",
      validExpiry: 2_000_000_000,
    }) as Electron.Certificate,
);

const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-client-certificates-" });
  const prompts: Electron.MessageBoxOptions[] = [];
  const events = new NodeEvents.EventEmitter();
  let reply = { response: 2, checkboxChecked: true };
  const create = make.pipe(
    Effect.provideService(DesktopEnvironment.DesktopEnvironment, {
      path,
      stateDir,
    } as DesktopEnvironment.DesktopEnvironment["Service"]),
    Effect.provideService(ElectronApp.ElectronApp, {
      ...ElectronApp.make,
      on: (name, listener) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            events.on(name, listener);
          }),
          () =>
            Effect.sync(() => {
              events.removeListener(name, listener);
            }),
        ),
    }),
    Effect.provideService(ElectronDialog.ElectronDialog, {
      ...ElectronDialog.make,
      showMessageBox: (options) =>
        Effect.sync(() => {
          prompts.push(options);
          return reply;
        }),
    }),
  );
  return {
    create,
    prompts,
    events,
    settingsPath: path.join(stateDir, "client-certificates.json"),
    respond: (next: typeof reply) => {
      reply = next;
    },
  };
});

describe("client certificate selection", () => {
  it.effect("chooses a certificate before pairing without sending a pairing code", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      const service = yield* fixture.create;
      yield* service.register;
      netFetch.mockImplementationOnce((url: string, options: RequestInit) => {
        assert.equal(url, "https://work.test/");
        assert.equal(options.method, "HEAD");
        assert.equal(options.redirect, "manual");
        assert.equal(options.credentials, "include");
        return new Promise<Response>((resolve, reject) => {
          fixture.events.emit(
            "select-client-certificate",
            { preventDefault() {} },
            null,
            // Electron emits HostPortPair::ToString(), without a URL scheme.
            "work.test:443",
            certificates,
            (certificate: Electron.Certificate | undefined) => {
              if (certificate === certificates[1]) resolve(new Response(null, { status: 401 }));
              else reject(new Error("Client certificate required"));
            },
          );
        });
      });
      const selected = yield* service.prepare("https://work.test/?pairingCode=SECRET");
      assert.equal(selected?.subjectName, "Laptop 2");
      assert.lengthOf(fixture.prompts, 1);
      assert.lengthOf(yield* (yield* fixture.create).list, 1);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("allows setup without T3 authentication when the server needs no certificate", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      const service = yield* fixture.create;
      netFetch.mockResolvedValueOnce(new Response(null, { status: 405 }));
      assert.isNull(yield* service.prepare("wss://work.test:8443/ws"));
      assert.equal(netFetch.mock.lastCall?.[0], "https://work.test:8443/");
      assert.isEmpty(fixture.prompts);
      assert.isEmpty(yield* service.list);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("reports a failed TLS setup without saving a certificate", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      const service = yield* fixture.create;
      netFetch.mockRejectedValueOnce(new Error("net::ERR_SSL_CLIENT_AUTH_CERT_NEEDED"));
      const error = yield* service.prepare("https://work.test").pipe(Effect.flip);
      assert.include(error.message, "ERR_SSL_CLIENT_AUTH_CERT_NEEDED");
      assert.isEmpty(yield* service.list);
      const requests = netFetch.mock.calls.length;
      for (const url of ["http://work.test", "https://user:secret@work.test", "bad url"]) {
        yield* service.prepare(url).pipe(Effect.flip);
      }
      assert.equal(netFetch.mock.calls.length, requests);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("accepts a completed TLS handshake when Electron blocks a redirect", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      const service = yield* fixture.create;
      netFetch.mockRejectedValueOnce(new Error("Redirect was cancelled"));
      assert.isNull(yield* service.prepare("https://work.test"));
      assert.equal(netFetch.mock.lastCall?.[1].redirect, "manual");
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it("normalizes HTTPS and WSS endpoints without widening the server scope", () => {
    assert.equal(clientCertificateOrigin("https://EXAMPLE.test:443/path"), "https://example.test");
    assert.equal(
      clientCertificateOrigin("wss://example.test:8443/ws"),
      "https://example.test:8443",
    );
    assert.equal(clientCertificateOrigin("EXAMPLE.test:443"), "https://example.test");
    assert.equal(clientCertificateOrigin("example.test:8443"), "https://example.test:8443");
    assert.equal(clientCertificateOrigin("[::1]:443"), "https://[::1]");
    assert.equal(clientCertificateOrigin("[::1]:8443"), "https://[::1]:8443");
    for (const url of [
      "http://example.test",
      "ws://example.test",
      "file:///tmp",
      "bad url",
      "https://user:secret@example.test",
      "user:secret@example.test:443",
      "example.test:443/path",
      "example.test:443?token=secret",
      "example.test:443#token=secret",
      "example.test:99999",
    ]) {
      assert.isNull(clientCertificateOrigin(url));
    }
  });

  it.effect(
    "persists the chosen identity and restores it independent of certificate ordering",
    () =>
      Effect.gen(function* () {
        const fixture = yield* setup;
        const service = yield* fixture.create;
        assert.strictEqual(
          yield* service.select("https://work.test/api", certificates),
          certificates[1],
        );
        const restored = yield* fixture.create;
        assert.strictEqual(
          yield* restored.select("wss://work.test/ws", certificates.toReversed()),
          certificates[1],
        );
        assert.lengthOf(fixture.prompts, 1);
        const saved = yield* restored.list;
        assert.equal(
          saved[0]?.fingerprint,
          new NodeCrypto.X509Certificate(certificates[1]!.data).fingerprint256,
        );
        const contents = yield* (yield* FileSystem.FileSystem).readFileString(fixture.settingsPath);
        assert.notInclude(contents, "BEGIN CERTIFICATE");
        assert.notInclude(contents, "PRIVATE KEY");
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("asks separately for another hostname, subdomain, or port", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      const service = yield* fixture.create;
      for (const url of [
        "https://work.test",
        "https://other.test",
        "https://sub.work.test",
        "https://work.test:8443",
      ]) {
        yield* service.select(url, certificates);
      }
      assert.lengthOf(fixture.prompts, 4);
      assert.lengthOf(yield* service.list, 4);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("cancels without presenting or remembering a certificate", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      fixture.respond({ response: 0, checkboxChecked: true });
      const service = yield* fixture.create;
      assert.isUndefined(yield* service.select("https://work.test", certificates));
      assert.isEmpty(yield* service.list);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("supports a one-time choice without persisting it", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      fixture.respond({ response: 1, checkboxChecked: false });
      const service = yield* fixture.create;
      assert.strictEqual(yield* service.select("https://work.test", certificates), certificates[0]);
      assert.isEmpty(yield* service.list);
      assert.isEmpty(yield* (yield* fixture.create).list);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("asks again when the saved certificate is unavailable and can forget a choice", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      const service = yield* fixture.create;
      yield* service.select("https://work.test", certificates);
      fixture.respond({ response: 0, checkboxChecked: true });
      assert.isUndefined(yield* service.select("https://work.test", certificates.slice(0, 1)));
      assert.include(fixture.prompts[1]?.detail, "no longer available");
      yield* service.forget("https://work.test");
      assert.isEmpty(yield* (yield* fixture.create).list);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("explains missing platform certificates and rejects insecure destinations", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      const service = yield* fixture.create;
      assert.isUndefined(yield* service.select("https://work.test", []));
      assert.include(fixture.prompts[0]?.message, "no matching certificates");
      assert.isUndefined(yield* service.select("http://work.test", certificates));
      assert.lengthOf(fixture.prompts, 1);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("serializes simultaneous requests so a remembered choice prompts only once", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      const service = yield* fixture.create;
      const selections = yield* Effect.all(
        [
          service.select("https://work.test/a", certificates),
          service.select("https://work.test/b", certificates),
        ],
        { concurrency: "unbounded" },
      );
      assert.deepEqual(selections, [certificates[1], certificates[1]]);
      assert.lengthOf(fixture.prompts, 1);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect(
    "declines Electron's default selection and completes failed requests without a certificate",
    () =>
      Effect.gen(function* () {
        const fixture = yield* setup;
        const service = yield* fixture.create;
        let prevented = false;
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* service.register;
            const selected = yield* Effect.promise(
              () =>
                new Promise<Electron.Certificate | undefined>((resolve) => {
                  fixture.events.emit(
                    "select-client-certificate",
                    {
                      preventDefault: () => {
                        prevented = true;
                      },
                    },
                    null,
                    "https://work.test",
                    [{ ...certificates[0], data: "invalid PEM" }],
                    resolve,
                  );
                }),
            );
            assert.isUndefined(selected);
            assert.isTrue(prevented);
          }),
        );
        assert.equal(fixture.events.listenerCount("select-client-certificate"), 0);
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("keeps the previous preferences when saving fails", () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      const service = yield* fixture.create;
      const fs = yield* FileSystem.FileSystem;
      // A directory at the destination makes the atomic rename fail on both OSes.
      yield* fs.makeDirectory(fixture.settingsPath);
      const error = yield* service.select("https://work.test", certificates).pipe(Effect.flip);
      assert.equal(error.operation, "save");
      assert.isEmpty(yield* service.list);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});
