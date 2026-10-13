import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useQueuedMessageStore, type QueuedComposerMessage } from "../queuedMessageStore";
import { sendQueuedMessage } from "./chat/sendQueuedMessage";
import { QueuedMessageSender } from "./QueuedMessageSender";
import { renderImageAnnotations } from "../lib/renderImageAnnotations";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "./chat/composerPromptHistory";
import {
  startAttachmentUpload,
  getUploadedAttachments,
  releaseDraftAttachments,
} from "../lib/attachmentUploadQueue";

const io = vi.hoisted(() => ({
  run: vi.fn(),
  upload: vi.fn(),
  toast: vi.fn(),
  thread: null as unknown,
  shell: { runtimeMode: "full-access", interactionMode: "default" } as Record<string, unknown>,
}));
const config = {
  environment: { capabilities: { attachmentUploads: true, inlineMessageContext: true } },
};
vi.mock("@t3tools/client-runtime/state/runtime", async (load) => ({
  ...(await load<typeof import("@t3tools/client-runtime/state/runtime")>()),
  runAtomCommand: (...args: unknown[]) => io.run(...args),
}));
vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: { get: () => new Map([["env-a", config]]) },
}));
vi.mock("../state/server", () => ({ environmentServerConfigsAtom: {} }));
vi.mock("../state/threads", () => ({
  threadEnvironment: {
    updateMetadata: "metadata",
    setRuntimeMode: "runtime",
    setInteractionMode: "interaction",
    startTurn: "start",
  },
}));
vi.mock("../state/environments", () => ({
  useEnvironment: () => ({ connection: { phase: "connected" } }),
}));
vi.mock("../state/entities", () => ({
  useThread: () => io.thread,
  useThreadStatus: () => "live",
  useServerConfigs: () => new Map([["env-a", config]]),
  readThreadShell: () => io.shell,
  readThread: () => io.thread,
}));
vi.mock("./ui/toast", () => ({ toastManager: { add: (...args: unknown[]) => io.toast(...args) } }));
vi.mock("../lib/attachmentUploadQueue", () => ({
  startAttachmentUpload: vi.fn(),
  awaitAttachmentUploads: (...args: unknown[]) => io.upload(...args),
  getUploadedAttachments: vi.fn(() => [
    { type: "image", id: "uploaded", name: "a.png", mimeType: "image/png", sizeBytes: 4 },
  ]),
  releaseDraftAttachments: vi.fn(),
}));
vi.mock("../lib/renderImageAnnotations", () => ({ renderImageAnnotations: vi.fn() }));

const threadRef = scopeThreadRef(EnvironmentId.make("env-a"), ThreadId.make("thread-a"));
const threadKey = scopedThreadKey(threadRef);
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" };

function enqueue(overrides: Partial<QueuedComposerMessage> = {}) {
  return useQueuedMessageStore.getState().enqueue(threadKey, {
    prompt: "follow up",
    images: [],
    files: [],
    terminalContexts: [],
    previewAnnotations: [],
    reviewComments: [],
    sendSettings: {
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      promptEffort: null,
    },
    queuedAfterToolActivityId: null,
    createdAt: "2026-09-25T00:00:00Z",
    ...overrides,
  });
}

const commandsRun = () => io.run.mock.calls.map((call) => call[1]);
const queue = () => useQueuedMessageStore.getState().queuesByThreadKey[threadKey];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useQueuedMessageStore.setState({ queuesByThreadKey: {}, lastDispatchByThreadKey: {} });
  io.thread = null;
  io.run.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  io.upload.mockReset().mockResolvedValue(undefined);
  io.toast.mockReset();
  vi.mocked(startAttachmentUpload).mockClear();
  vi.mocked(releaseDraftAttachments).mockClear();
  vi.mocked(renderImageAnnotations).mockReset();
  vi.mocked(getUploadedAttachments)
    .mockReset()
    .mockReturnValue([
      { type: "image", id: "uploaded", name: "a.png", mimeType: "image/png", sizeBytes: 4 },
    ]);
  io.shell = {
    modelSelection,
    branch: null,
    runtimeMode: "full-access",
    interactionMode: "default",
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QueuedMessageSender", () => {
  it("dispatches a rendered snapshot with comments while keeping the queued original editable until it succeeds", async () => {
    const file = new File(["original"], "a.png", { type: "image/png" });
    const marked = new File(["burned pixels"], "a-annotated.png", { type: "image/png" });
    const annotation = {
      id: "circle-1",
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
      comment: "Make this larger.",
    };
    const original = {
      type: "image" as const,
      id: "image-1",
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      previewUrl: "data:image/png;base64,AAAA",
      file,
      annotations: [annotation],
    };
    vi.mocked(renderImageAnnotations).mockResolvedValue(marked);
    vi.mocked(getUploadedAttachments).mockImplementation(({ images }) =>
      images.map((image) => ({
        type: image.type,
        id: "uploaded-rendered",
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
      })),
    );
    const message = enqueue({ images: [original] });
    await sendQueuedMessage(threadRef, message.id);
    const exported = vi.mocked(startAttachmentUpload).mock.calls[0]?.[0].image;
    expect(exported?.file).toBe(marked);
    expect(exported?.id).not.toBe(original.id);
    expect(io.run.mock.calls.at(-1)?.[2]).toMatchObject({
      input: {
        message: {
          text: "follow up\n\nannotations for a.png:\n1. Make this larger.",
          attachments: [{ name: marked.name, sizeBytes: marked.size, id: "uploaded-rendered" }],
          context: {
            records: [
              {
                contextId: "image_image-1",
                burnedAnnotationCount: 1,
                annotations: [annotation],
                attachmentId: "uploaded-rendered",
              },
            ],
          },
        },
      },
    });
    expect(original.file).toBe(file);
    expect(original.annotations).toEqual([annotation]);
    expect(queue()).toBeUndefined();
    expect(releaseDraftAttachments).toHaveBeenCalledWith([exported]);
  });

  it("keeps the original and editable comments queued when rendering fails", async () => {
    const file = new File(["original"], "a.png", { type: "image/png" });
    const original = {
      type: "image" as const,
      id: "image-1",
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      previewUrl: "data:image/png;base64,AAAA",
      file,
      annotations: [
        { id: "circle-1", x: 0.1, y: 0.2, width: 0.3, height: 0.4, comment: "Make this larger." },
      ],
    };
    vi.mocked(renderImageAnnotations).mockRejectedValue(new Error("Cannot decode image."));
    const message = enqueue({ images: [original] });
    await sendQueuedMessage(threadRef, message.id);
    expect(commandsRun()).toEqual([]);
    expect(queue()?.[0]?.images[0]).toBe(original);
    expect(queue()?.[0]?.holdUntilUserAction).toBe(true);
    expect(io.toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Cannot decode image." }),
    );
    expect(queue()?.[0]?.prompt).toBe("follow up");

    vi.mocked(renderImageAnnotations).mockResolvedValue(
      new File(["marked"], "a-annotated.png", { type: "image/png" }),
    );
    await sendQueuedMessage(threadRef, message.id);
    expect(io.run.mock.calls.at(-1)?.[2]).toMatchObject({
      input: { message: { text: "follow up\n\nannotations for a.png:\n1. Make this larger." } },
    });
    expect(queue()).toBeUndefined();
  });

  it("sends grouped comments instead of the attachment-only placeholder without draft text", async () => {
    const image = (name: string, comments: string[]) => ({
      type: "image" as const,
      id: name,
      name,
      mimeType: "image/png",
      sizeBytes: 4,
      previewUrl: "data:image/png;base64,AAAA",
      file: new File(["AAAA"], name, { type: "image/png" }),
      burnedAnnotationCount: comments.length,
      annotations: comments.map((comment, index) => ({
        id: `circle-${index}`,
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.4,
        comment,
      })),
    });
    const message = enqueue({
      prompt: "",
      images: [
        image("image1.png", ["annotation 1", "annotation 2"]),
        image("image2.png", ["annotation 1", "annotation 2"]),
      ],
    });
    await sendQueuedMessage(threadRef, message.id);
    expect(io.run.mock.calls.at(-1)?.[2]).toMatchObject({
      input: {
        message: {
          text: "annotations for image1.png:\n1. annotation 1\n2. annotation 2\n\nannotations for image2.png:\n1. annotation 1\n2. annotation 2",
        },
      },
    });
    expect(renderImageAnnotations).not.toHaveBeenCalled();
  });

  it("keeps the attachment-only placeholder when circles have no comment text", async () => {
    const message = enqueue({
      prompt: "",
      images: [
        {
          type: "image",
          id: "image-1",
          name: "a.png",
          mimeType: "image/png",
          sizeBytes: 4,
          previewUrl: "data:image/png;base64,AAAA",
          file: new File(["AAAA"], "a.png", { type: "image/png" }),
          burnedAnnotationCount: 1,
          annotations: [
            { id: "circle-1", x: 0.1, y: 0.2, width: 0.3, height: 0.4, comment: "  \n  " },
          ],
        },
      ],
    });
    await sendQueuedMessage(threadRef, message.id);
    expect(io.run.mock.calls.at(-1)?.[2]).toMatchObject({
      input: { message: { text: ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } },
    });
  });

  const thread = (
    status: string,
    { toolActivityIds = [] as string[], userMessageIds = [] as string[] } = {},
  ) => ({
    session: { status, activeTurnId: null, updatedAt: status },
    activities: toolActivityIds.map((id, index) => ({
      id,
      kind: "tool.completed",
      sequence: index,
      createdAt: "2026-09-25T00:00:01Z",
    })),
    messages: userMessageIds.map((id) => ({ id, role: "user" })),
    latestTurn: null,
  });
  let root: ReactTestRenderer | null = null;
  const render = () =>
    act(() => {
      if (root) root.update(createElement(QueuedMessageSender));
      else root = create(createElement(QueuedMessageSender));
    });
  afterEach(async () => {
    await act(() => root?.unmount());
    root = null;
  });

  it("sends a queued message when the turn ends, with no chat view open", async () => {
    enqueue();
    io.thread = thread("running");
    await render();
    expect(commandsRun()).toEqual([]);

    io.thread = thread("ready");
    await render();

    expect(commandsRun()).toEqual(["start"]);
    expect(io.run.mock.calls[0]?.[2]).toMatchObject({
      environmentId: "env-a",
      input: { threadId: "thread-a", message: { text: "follow up" }, modelSelection },
    });
    expect(queue()).toBeUndefined();
  });

  it("holds the next message until the server picks up the one before it", async () => {
    enqueue({ prompt: "first" });
    enqueue({ prompt: "second" });
    io.thread = thread("ready");
    await render();
    await render();
    expect(commandsRun()).toEqual(["start"]);

    // The first message started a turn; the second waits for its next tool call.
    io.thread = thread("running", { userMessageIds: ["first"] });
    await render();
    expect(commandsRun()).toEqual(["start"]);
    io.thread = thread("running", { userMessageIds: ["first"], toolActivityIds: ["tool-1"] });
    await render();
    expect(commandsRun()).toEqual(["start", "start"]);
  });

  it("moves on to the next message after a failed one is cancelled", async () => {
    io.run.mockResolvedValueOnce({ _tag: "Failure", cause: Cause.fail(new Error("offline")) });
    const first = enqueue({ prompt: "first" });
    enqueue({ prompt: "second" });
    io.thread = thread("ready");
    await render();
    expect(queue()?.[0]).toMatchObject({ prompt: "first", holdUntilUserAction: true });

    await act(() => {
      useQueuedMessageStore.getState().remove(threadKey, first.id);
    });
    await render();

    expect(commandsRun()).toEqual(["start", "start"]);
    expect(io.run.mock.calls[1]?.[2]).toMatchObject({ input: { message: { text: "second" } } });
  });
});

describe("sendQueuedMessage", () => {
  it("saves a mode changed before queueing, then starts the turn", async () => {
    io.shell = { ...io.shell, runtimeMode: "approval-required" };
    const message = enqueue();

    await sendQueuedMessage(threadRef, message.id);

    expect(commandsRun()).toEqual(["runtime", "start"]);
    expect(io.run.mock.calls[1]?.[2]).toMatchObject({ input: { runtimeMode: "full-access" } });
    expect(queue()).toBeUndefined();
  });

  it("gives a message back to Stop while its upload runs, without starting a turn", async () => {
    let finishUpload!: () => void;
    io.upload.mockReturnValue(new Promise<void>((resolve) => (finishUpload = resolve)));
    const image = {
      type: "image" as const,
      id: "image-1",
      name: "a.png",
      mimeType: "image/png",
      sizeBytes: 4,
      previewUrl: "data:image/png;base64,AAAA",
      file: new File(["AAAA"], "a.png", { type: "image/png" }),
    };
    const message = enqueue({ images: [image] });

    const sending = sendQueuedMessage(threadRef, message.id);
    expect(useQueuedMessageStore.getState().drain(threadKey)).toHaveLength(1);
    finishUpload();
    await sending;

    expect(commandsRun()).toEqual([]);
    expect(io.toast).not.toHaveBeenCalled();
    expect(queue()).toBeUndefined();
  });

  it("holds a message at the head when the turn start fails", async () => {
    io.run.mockResolvedValue({ _tag: "Failure", cause: Cause.fail(new Error("offline")) });
    enqueue({ prompt: "first" });
    const second = enqueue({ prompt: "second" });

    await sendQueuedMessage(threadRef, second.id);

    expect(queue()?.map((entry) => [entry.prompt, entry.holdUntilUserAction])).toEqual([
      ["second", true],
      ["first", undefined],
    ]);
    expect(io.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "offline" }));
  });
});
