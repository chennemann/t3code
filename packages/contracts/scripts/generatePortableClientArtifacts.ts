import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";

import {
    ClientOrchestrationCommand,
    EnvironmentClientConfig,
    OrchestrationShellSnapshot,
    OrchestrationShellStreamItem,
    OrchestrationThreadDetailSnapshot,
    OrchestrationThreadStreamItem,
    PORTABLE_CLIENT_PROTOCOL_VERSION,
    PortableClientOpenApi,
} from "../src/index.ts";

const repositoryRoot = NodePath.resolve(import.meta.dirname, "../../..");
const outputRoot = NodePath.resolve(repositoryRoot, "packages/contracts/portable/v1");
const formatterPath = NodePath.resolve(repositoryRoot, "node_modules/vite-plus/bin/oxfmt");
const checkOnly = process.argv.includes("--check");
const files = new Map<string, string>();

function sortJson(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortJson);
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, child]) => [key, sortJson(child)]),
        );
    }
    return value;
}

const stableJson = (path: string, value: unknown) =>
    NodeChildProcess.execFileSync(process.execPath, [formatterPath, `--stdin-filepath=${path}`], {
        cwd: repositoryRoot,
        encoding: "utf8",
        input: JSON.stringify(sortJson(value), null, 2),
    });
const sha256 = (value: string) => NodeCrypto.createHash("sha256").update(value).digest("hex");
const add = (path: string, value: unknown) => files.set(path, stableJson(path, value));

const at = "2026-01-01T00:00:00.000Z";
const later = "2026-01-01T00:00:01.000Z";
const projectId = "project-golden";
const threadId = "thread-golden";
const turnId = "turn-golden";
const modelSelection = {
    instanceId: "provider-golden",
    model: "model-golden",
};

const project = {
    id: projectId,
    title: "Golden project",
    workspaceRoot: "/workspace/golden",
    defaultModelSelection: modelSelection,
    scripts: [],
    createdAt: at,
    updatedAt: at,
};

const session = {
    threadId,
    status: "running",
    providerName: "Golden provider",
    providerInstanceId: "provider-golden",
    runtimeMode: "approval-required",
    activeTurnId: turnId,
    lastError: null,
    updatedAt: later,
};

const activities = [
    {
        id: "activity-info",
        tone: "info",
        kind: "status.updated",
        summary: "Inspecting the project",
        payload: { phase: "analysis" },
        turnId,
        sequence: 46,
        createdAt: later,
    },
    {
        id: "activity-tool",
        tone: "tool",
        kind: "tool.completed",
        summary: "Read project files",
        payload: { toolName: "read", paths: ["README.md"] },
        turnId,
        sequence: 47,
        createdAt: later,
    },
    {
        id: "activity-approval",
        tone: "approval",
        kind: "approval.requested",
        summary: "Command approval requested",
        payload: {
            requestId: "approval-golden",
            requestKind: "command",
            decisions: ["accept", "acceptForSession", "decline", "cancel"],
            command: "vp test run",
        },
        turnId,
        sequence: 48,
        createdAt: later,
    },
    {
        id: "activity-user-input",
        tone: "approval",
        kind: "user-input.requested",
        summary: "More information is required",
        payload: {
            requestId: "input-golden",
            questions: [
                {
                    id: "target",
                    prompt: "Which target should be used?",
                    options: ["debug", "release"],
                },
            ],
        },
        turnId,
        sequence: 49,
        createdAt: later,
    },
    {
        id: "activity-error",
        tone: "error",
        kind: "provider.error",
        summary: "A recoverable provider error occurred",
        payload: { detail: "fixture error" },
        turnId,
        sequence: 50,
        createdAt: later,
    },
    {
        id: "activity-unknown",
        tone: "info",
        kind: "future.additive-activity",
        summary: "Unknown additive activity",
        payload: { nested: { safe: true }, futureField: 1 },
        turnId,
        sequence: 51,
        createdAt: later,
    },
];

const latestTurn = {
    turnId,
    state: "running",
    requestedAt: at,
    startedAt: at,
    completedAt: null,
    assistantMessageId: "message-assistant",
};

const thread = {
    id: threadId,
    projectId,
    title: "Golden thread",
    modelSelection,
    runtimeMode: "approval-required",
    interactionMode: "plan",
    branch: null,
    worktreePath: null,
    latestTurn,
    createdAt: at,
    updatedAt: later,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    deletedAt: null,
    messages: [
        {
            id: "message-user",
            role: "user",
            text: "Create the portable fixture",
            attachments: [],
            turnId,
            streaming: false,
            createdAt: at,
            updatedAt: at,
        },
        {
            id: "message-assistant",
            role: "assistant",
            text: "Generating",
            attachments: [],
            turnId,
            streaming: true,
            createdAt: at,
            updatedAt: later,
        },
    ],
    proposedPlans: [
        {
            id: "plan-golden",
            turnId,
            planMarkdown: "1. Generate the protocol artifacts.",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: at,
            updatedAt: later,
        },
    ],
    activities,
    checkpoints: [],
    session,
};

const threadShell = {
    id: threadId,
    projectId,
    title: "Golden thread",
    modelSelection,
    runtimeMode: "approval-required",
    interactionMode: "plan",
    branch: null,
    worktreePath: null,
    latestTurn,
    createdAt: at,
    updatedAt: later,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    session,
    latestUserMessageAt: at,
    hasPendingApprovals: true,
    hasPendingUserInput: true,
    hasActionableProposedPlan: true,
};

const shellSnapshot = {
    snapshotSequence: 40,
    projects: [project],
    threads: [threadShell],
    updatedAt: later,
};

const threadSnapshot = {
    snapshotSequence: 40,
    thread,
};

const event = (sequence: number, type: string, payload: unknown) => ({
    sequence,
    eventId: `event-${sequence}`,
    aggregateKind: "thread",
    aggregateId: threadId,
    occurredAt: later,
    commandId: `command-${sequence}`,
    causationEventId: null,
    correlationId: `command-${sequence}`,
    metadata: {},
    type,
    payload,
});

const shellStreamItems = [
    { kind: "snapshot", snapshot: shellSnapshot },
    { kind: "project-upserted", sequence: 41, project: { ...project, updatedAt: later } },
    { kind: "project-removed", sequence: 42, projectId },
    { kind: "thread-upserted", sequence: 43, thread: threadShell },
    { kind: "thread-removed", sequence: 44, threadId },
    { kind: "synchronized" },
];

const threadStreamItems = [
    { kind: "snapshot", snapshot: threadSnapshot },
    {
        kind: "event",
        event: event(41, "thread.meta-updated", {
            threadId,
            title: "Renamed golden thread",
            modelSelection,
            updatedAt: later,
        }),
    },
    {
        kind: "event",
        event: event(42, "thread.runtime-mode-set", {
            threadId,
            runtimeMode: "approval-required",
            updatedAt: later,
        }),
    },
    {
        kind: "event",
        event: event(43, "thread.interaction-mode-set", {
            threadId,
            interactionMode: "plan",
            updatedAt: later,
        }),
    },
    {
        kind: "event",
        event: event(44, "thread.message-sent", {
            threadId,
            messageId: "message-assistant",
            role: "assistant",
            text: "Generating",
            attachments: [],
            turnId,
            streaming: true,
            createdAt: at,
            updatedAt: later,
        }),
    },
    {
        kind: "event",
        event: event(45, "thread.turn-start-requested", {
            threadId,
            messageId: "message-user",
            modelSelection,
            titleSeed: "Create the portable fixture",
            runtimeMode: "approval-required",
            interactionMode: "plan",
            createdAt: at,
        }),
    },
    {
        kind: "event",
        event: event(46, "thread.turn-interrupt-requested", {
            threadId,
            turnId,
            createdAt: later,
        }),
    },
    {
        kind: "event",
        event: event(47, "thread.approval-response-requested", {
            threadId,
            requestId: "approval-golden",
            decision: "accept",
            createdAt: later,
        }),
    },
    {
        kind: "event",
        event: event(48, "thread.user-input-response-requested", {
            threadId,
            requestId: "input-golden",
            answers: { target: "debug" },
            createdAt: later,
        }),
    },
    {
        kind: "event",
        event: event(49, "thread.session-set", {
            threadId,
            session,
        }),
    },
    {
        kind: "event",
        event: event(50, "thread.proposed-plan-upserted", {
            threadId,
            proposedPlan: thread.proposedPlans[0],
        }),
    },
    ...activities.map((activity, index) => ({
        kind: "event",
        event: event(51 + index, "thread.activity-appended", {
            threadId,
            activity: { ...activity, sequence: 51 + index },
        }),
    })),
    { kind: "synchronized" },
];

const commands = [
    {
        type: "thread.turn.start",
        commandId: "command-start-existing",
        threadId,
        message: {
            messageId: "message-existing",
            role: "user",
            text: "Continue the portable fixture",
            attachments: [],
        },
        modelSelection,
        runtimeMode: "approval-required",
        interactionMode: "plan",
        createdAt: at,
    },
    {
        type: "thread.turn.start",
        commandId: "command-start-new",
        threadId: "thread-new",
        message: {
            messageId: "message-new",
            role: "user",
            text: "Start a portable thread",
            attachments: [],
        },
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        bootstrap: {
            createThread: {
                projectId,
                title: "Start a portable thread",
                modelSelection,
                runtimeMode: "full-access",
                interactionMode: "default",
                branch: null,
                worktreePath: null,
                createdAt: at,
            },
        },
        createdAt: at,
    },
    {
        type: "thread.turn.interrupt",
        commandId: "command-interrupt",
        threadId,
        turnId,
        createdAt: later,
    },
    {
        type: "thread.meta.update",
        commandId: "command-rename",
        threadId,
        title: "Renamed golden thread",
        modelSelection,
    },
    { type: "thread.archive", commandId: "command-archive", threadId },
    { type: "thread.unarchive", commandId: "command-unarchive", threadId },
    {
        type: "thread.runtime-mode.set",
        commandId: "command-runtime-mode",
        threadId,
        runtimeMode: "approval-required",
        createdAt: later,
    },
    {
        type: "thread.interaction-mode.set",
        commandId: "command-interaction-mode",
        threadId,
        interactionMode: "plan",
        createdAt: later,
    },
    {
        type: "thread.approval.respond",
        commandId: "command-approval",
        threadId,
        requestId: "approval-golden",
        decision: "acceptForSession",
        createdAt: later,
    },
    {
        type: "thread.user-input.respond",
        commandId: "command-user-input",
        threadId,
        requestId: "input-golden",
        answers: { target: "debug" },
        createdAt: later,
    },
];

const clientConfig = {
    environment: {
        environmentId: "environment-golden",
        label: "Golden environment",
        platform: { os: "linux", arch: "x64" },
        serverVersion: "0.0.0-golden",
        capabilities: {
            repositoryIdentity: true,
            connectionProbe: true,
            threadSettlement: true,
            threadSnooze: true,
            threadWorktrees: true,
            portableClientProtocol: PORTABLE_CLIENT_PROTOCOL_VERSION,
        },
    },
    auth: {
        policy: "remote-reachable",
        bootstrapMethods: ["one-time-token"],
        sessionMethods: ["bearer-access-token"],
        sessionCookieName: "t3-session",
    },
    providers: [
        {
            instanceId: "provider-golden",
            driver: "codex",
            displayName: "Golden provider",
            showInteractionModeToggle: true,
            enabled: true,
            installed: true,
            version: null,
            status: "ready",
            auth: { status: "authenticated" },
            checkedAt: at,
            availability: "available",
            models: [
                {
                    slug: "model-golden",
                    name: "Golden model",
                    isCustom: false,
                    isDefault: true,
                    capabilities: { optionDescriptors: [] },
                },
            ],
            slashCommands: [
                {
                    name: "review",
                    description: "Review the current changes",
                    input: { hint: "optional focus" },
                },
            ],
            skills: [],
        },
    ],
    shellResumeCompletionMarker: true,
    threadResumeCompletionMarker: true,
    protocolVersion: PORTABLE_CLIENT_PROTOCOL_VERSION,
};

Schema.decodeUnknownSync(EnvironmentClientConfig)(clientConfig);
Schema.decodeUnknownSync(Schema.Array(ClientOrchestrationCommand))(commands);
Schema.decodeUnknownSync(OrchestrationShellSnapshot)(shellSnapshot);
Schema.decodeUnknownSync(Schema.Array(OrchestrationShellStreamItem))(shellStreamItems);
Schema.decodeUnknownSync(OrchestrationThreadDetailSnapshot)(threadSnapshot);
Schema.decodeUnknownSync(Schema.Array(OrchestrationThreadStreamItem))(threadStreamItems);

add("openapi.json", OpenApi.fromApi(PortableClientOpenApi));
add("protocol-version.json", {
    protocol: "t3-portable-client",
    version: PORTABLE_CLIENT_PROTOCOL_VERSION,
});
for (const [name, schema] of [
    ["client-config", EnvironmentClientConfig],
    ["orchestration-command", ClientOrchestrationCommand],
    ["shell-snapshot", OrchestrationShellSnapshot],
    ["shell-stream-item", OrchestrationShellStreamItem],
    ["thread-snapshot", OrchestrationThreadDetailSnapshot],
    ["thread-stream-item", OrchestrationThreadStreamItem],
] as const) {
    add(`schemas/${name}.schema.json`, Schema.toJsonSchemaDocument(schema));
}
add("fixtures/client-config.json", clientConfig);
add("fixtures/commands.json", commands);
add("fixtures/shell-stream-items.json", shellStreamItems);
add("fixtures/thread-stream-items.json", threadStreamItems);

const fixtureEntries = Array.from(files.entries())
    .filter(([path]) => path.startsWith("fixtures/"))
    .sort(([left], [right]) => left.localeCompare(right));
add("fixture-manifest.json", {
    algorithm: "sha256",
    checksum: sha256(fixtureEntries.map(([path, content]) => `${path}\0${content}`).join("")),
    files: fixtureEntries.map(([path, content]) => ({
        path,
        sha256: sha256(content),
    })),
});

const artifactEntries = Array.from(files.entries()).sort(([left], [right]) => left.localeCompare(right));
add("artifact-manifest.json", {
    protocolVersion: PORTABLE_CLIENT_PROTOCOL_VERSION,
    algorithm: "sha256",
    checksum: sha256(artifactEntries.map(([path, content]) => `${path}\0${content}`).join("")),
    files: artifactEntries.map(([path, content]) => ({
        path,
        sha256: sha256(content),
    })),
});

for (const [path, content] of files) {
    const absolute = NodePath.resolve(outputRoot, path);
    if (checkOnly) {
        let existing: string | undefined;
        try {
            existing = await NodeFSP.readFile(absolute, "utf8");
        } catch {
            // The message below includes the missing path.
        }
        if (existing !== content) {
            console.error(`Portable protocol artifact is stale: ${path}`);
            process.exitCode = 1;
        }
        continue;
    }
    await NodeFSP.mkdir(NodePath.dirname(absolute), { recursive: true });
    await NodeFSP.writeFile(absolute, content, "utf8");
}
