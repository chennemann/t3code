import {
  DevinSettings,
  ProviderDriverKind,
  type ServerProvider,
  type ServerProviderSlashCommand,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import { makeDevinTextGeneration } from "../../textGeneration/DevinTextGeneration.ts";
import { ProviderDriverError } from "@t3tools/provider-core/server/errors";
import { makeDevinAdapter } from "../Layers/DevinAdapter.ts";
import {
  buildInitialDevinProviderSnapshot,
  checkDevinProviderStatus,
} from "../Layers/DevinProvider.ts";
import { makeManagedServerProvider } from "@t3tools/provider-core/server/managedProvider";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "@t3tools/provider-core/server/driver";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import {
  makeCachedProviderMaintenanceResolution,
  makeManualOnlyProviderMaintenanceCapabilities,
  makeProviderMaintenanceCapabilities,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "@t3tools/provider-core/server/maintenanceResolver";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
} from "@t3tools/provider-core/server/snapshotSettings";
import { withInstanceIdentity } from "@t3tools/provider-core/server/instanceIdentity";

const DRIVER_KIND = ProviderDriverKind.make("devin");
const decodeDevinSettings = Schema.decodeSync(DevinSettings);

export type DevinDriverEnv =
  | Exclude<Effect.Services<ReturnType<typeof makeDevinAdapter>>, import("effect/Scope").Scope>
  | ProviderHost.ProviderHost
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | Path.Path;

export const DevinDriver: ProviderDriver<DevinSettings, DevinDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "Devin", supportsMultipleInstances: true },
  configSchema: DevinSettings,
  defaultConfig: () => decodeDevinSettings({}),
  create: Effect.fn("DevinDriver.create")(function* ({
    instanceId,
    displayName,
    accentColor,
    environment,
    enabled,
    config,
  }) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const processEnv = yield* mergeProviderInstanceEnvironment(environment);
    const effectiveConfig = { ...config, enabled };
    const continuationIdentity = defaultProviderContinuationIdentity({
      driverKind: DRIVER_KIND,
      instanceId,
    });
    const stampIdentity = withInstanceIdentity({
      instanceId,
      driverKind: DRIVER_KIND,
      displayName,
      accentColor,
      continuationGroupKey: continuationIdentity.continuationKey,
    });
    const resolveMaintenance = yield* makeCachedProviderMaintenanceResolution(
      resolveProviderMaintenanceCapabilitiesEffect(
        {
          resolve: (context) =>
            Effect.succeed(
              context
                ? makeProviderMaintenanceCapabilities({
                    provider: DRIVER_KIND,
                    packageName: null,
                    updateExecutable: context.resolvedCommandPath,
                    updateArgs: ["update"],
                    updateLockKey: "devin",
                    platform: context.platform,
                    env: context.env,
                  })
                : makeManualOnlyProviderMaintenanceCapabilities({
                    provider: DRIVER_KIND,
                    packageName: null,
                  }),
            ),
        },
        { binaryPath: effectiveConfig.binaryPath, env: processEnv },
      ).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      ),
    );
    const snapshotSettings = yield* makeProviderSnapshotSettingsSource(effectiveConfig);
    const managedSnapshot = yield* makeManagedServerProvider({
      resolveMaintenance,
      getSettings: snapshotSettings.getSettings,
      streamSettings: snapshotSettings.streamSettings,
      haveSettingsChanged: haveProviderSnapshotSettingsChanged,
      initialSnapshot: (settings) =>
        buildInitialDevinProviderSnapshot(settings.provider).pipe(Effect.map(stampIdentity)),
      checkProvider: checkDevinProviderStatus(effectiveConfig, processEnv).pipe(
        Effect.map(stampIdentity),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      ),
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: DRIVER_KIND,
            instanceId,
            detail: "Failed to build Devin provider snapshot.",
            cause,
          }),
      ),
    );
    const commandChanges = yield* Effect.acquireRelease(
      PubSub.unbounded<ServerProvider>(),
      PubSub.shutdown,
    );
    let slashCommands: ReadonlyArray<ServerProviderSlashCommand> | undefined;
    const withCommands = (snapshot: ServerProvider): ServerProvider =>
      slashCommands ? { ...snapshot, slashCommands } : snapshot;
    const orchestrationAdapter = yield* makeDevinAdapter(effectiveConfig, {
      instanceId,
      environment: processEnv,
      onAvailableCommands: Effect.fn("DevinDriver.onAvailableCommands")(function* (commands) {
        slashCommands = commands;
        yield* PubSub.publish(commandChanges, withCommands(yield* managedSnapshot.getSnapshot));
      }),
    });
    const textGeneration = yield* makeDevinTextGeneration(effectiveConfig, processEnv);
    return {
      instanceId,
      driverKind: DRIVER_KIND,
      continuationIdentity,
      displayName,
      accentColor,
      enabled,
      orchestrationAdapter,
      textGeneration,
      snapshot: {
        ...managedSnapshot,
        getSnapshot: managedSnapshot.getSnapshot.pipe(Effect.map(withCommands)),
        refresh: managedSnapshot.refresh.pipe(Effect.map(withCommands)),
        streamChanges: Stream.merge(
          managedSnapshot.streamChanges.pipe(Stream.map(withCommands)),
          Stream.fromPubSub(commandChanges),
        ),
      },
    } satisfies ProviderInstance;
  }),
};
