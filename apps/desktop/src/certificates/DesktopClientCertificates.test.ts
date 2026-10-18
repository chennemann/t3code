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
  it("normalizes HTTPS and WSS endpoints without widening the server scope", () => {
    assert.equal(clientCertificateOrigin("https://EXAMPLE.test:443/path"), "https://example.test");
    assert.equal(
      clientCertificateOrigin("wss://example.test:8443/ws"),
      "https://example.test:8443",
    );
    for (const url of [
      "http://example.test",
      "ws://example.test",
      "file:///tmp",
      "bad url",
      "https://user:secret@example.test",
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
