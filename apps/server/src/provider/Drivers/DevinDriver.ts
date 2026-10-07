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
import { ChildProcessSpawner } from "effect/unstable/process";
import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeDevinTextGeneration } from "../../textGeneration/DevinTextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeDevinAdapter } from "../Layers/DevinAdapter.ts";
import {
  buildInitialDevinProviderSnapshot,
  checkDevinProviderStatus,
} from "../Layers/DevinProvider.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import {
  makeCachedProviderMaintenanceResolution,
  makeManualOnlyProviderMaintenanceCapabilities,
  makeProviderMaintenanceCapabilities,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
} from "../providerUpdateSettings.ts";
import { withInstanceIdentity } from "./instanceIdentity.ts";

const DRIVER_KIND = ProviderDriverKind.make("devin");
const decodeDevinSettings = Schema.decodeSync(DevinSettings);

export type DevinDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig
  | ServerSettingsService;

export const DevinDriver: ProviderDriver<DevinSettings, DevinDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "Devin", supportsMultipleInstances: true },
  configSchema: DevinSettings,
  defaultConfig: () => decodeDevinSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const serverSettings = yield* ServerSettingsService;
      const loggers = yield* ProviderEventLoggers;
      const processEnv = mergeProviderInstanceEnvironment(environment);
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
      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
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
      const adapter = yield* makeDevinAdapter(effectiveConfig, {
        instanceId,
        environment: processEnv,
        ...(loggers.native ? { nativeEventLogger: loggers.native } : {}),
        onAvailableCommands: (commands) =>
          Effect.gen(function* () {
            slashCommands = commands.map((command) => ({
              name: command.name,
              description: command.description,
              ...(command.input?.hint ? { argumentHint: command.input.hint } : {}),
            }));
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
        adapter,
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
