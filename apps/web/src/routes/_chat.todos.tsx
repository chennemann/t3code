import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
    type OrchestrationShellSnapshot,
    type OrchestrationTodo,
    type ProjectId,
    WORKSPACE_PROJECT_ID,
} from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/unstable/reactivity";
import { CheckIcon, ChevronRightIcon, CircleIcon, PlayIcon, PlusIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { SidebarInset } from "../components/ui/sidebar";
import { toastManager } from "../components/ui/toast";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { buildTodoDraftPrompt } from "../lib/todos";
import { useProjects } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { environmentSnapshotAtom } from "../state/shell";
import { todoCommands } from "../state/todos";
import { useAtomCommand } from "../state/use-atom-command";

export const Route = createFileRoute("/_chat/todos")({ component: TodosRoute });
const EMPTY_SNAPSHOT_ATOM = Atom.make<OrchestrationShellSnapshot | null>(null);

function TodosRoute() {
    const navigate = useNavigate();
    const environmentId = usePrimaryEnvironmentId();
    const snapshot = useAtomValue(
        environmentId === null ? EMPTY_SNAPSHOT_ATOM : environmentSnapshotAtom(environmentId),
    );
    const projects = useProjects().filter(
        (project) => project.environmentId === environmentId && project.id !== WORKSPACE_PROJECT_ID,
    );
    const todos = snapshot?.todos ?? [];
    const create = useAtomCommand(todoCommands.create);
    const update = useAtomCommand(todoCommands.update);
    const remove = useAtomCommand(todoCommands.delete);
    const handleNewThread = useNewThreadHandler();
    const [title, setTitle] = useState("");
    const [summary, setSummary] = useState("");
    const [projectId, setProjectId] = useState<ProjectId | null>(null);

    const { completedTodos, groups, subtasksByParentId } = useMemo(() => {
        const activeRootsByProjectId = new Map<ProjectId | null, OrchestrationTodo[]>();
        const completedRoots: OrchestrationTodo[] = [];
        const childrenByParentId = new Map<string, OrchestrationTodo[]>();

        for (const todo of todos) {
            if (todo.parentTodoId !== null) {
                const children = childrenByParentId.get(todo.parentTodoId) ?? [];
                children.push(todo);
                childrenByParentId.set(todo.parentTodoId, children);
            } else if (todo.completedAt !== null) {
                completedRoots.push(todo);
            } else {
                const roots = activeRootsByProjectId.get(todo.projectId) ?? [];
                roots.push(todo);
                activeRootsByProjectId.set(todo.projectId, roots);
            }
        }

        return {
            completedTodos: completedRoots,
            groups: [
                { key: "inbox", title: "Inbox", items: activeRootsByProjectId.get(null) ?? [] },
                ...projects.map((project) => ({
                    key: project.id,
                    title: project.title,
                    items: activeRootsByProjectId.get(project.id) ?? [],
                })),
            ].filter((group) => group.items.length > 0),
            subtasksByParentId: childrenByParentId,
        };
    }, [projects, todos]);

    const setCompleted = async (todo: OrchestrationTodo, completed: boolean) => {
        if (environmentId === null) return;
        await update({ environmentId, input: { todoId: todo.id, completed } });
        if (completed) {
            toastManager.add({
                type: "success",
                title: "To-do completed",
                timeout: 5_000,
                actionProps: {
                    children: "Undo",
                    onClick: () => void update({ environmentId, input: { todoId: todo.id, completed: false } }),
                },
            });
        }
    };

    const addTodo = async () => {
        const nextTitle = title.trim();
        if (environmentId === null || nextTitle.length === 0) return;
        await create({ environmentId, input: { title: nextTitle, summary: summary.trim(), projectId } });
        setTitle("");
        setSummary("");
    };

    const startTodo = async (todo: OrchestrationTodo) => {
        if (environmentId === null) return;
        const created = await handleNewThread(scopeProjectRef(environmentId, todo.projectId ?? WORKSPACE_PROJECT_ID));
        if (created !== null) {
            useComposerDraftStore.getState().setPrompt(created.draftId, buildTodoDraftPrompt(todo));
        }
    };

    const planTodo = async (todo: OrchestrationTodo) => {
        if (environmentId === null) return;
        const created = await handleNewThread(scopeProjectRef(environmentId, todo.projectId ?? WORKSPACE_PROJECT_ID));
        if (created === null) return;
        await update({ environmentId, input: { todoId: todo.id, planningThreadId: created.threadId } });
        await navigate({
            to: "/$environmentId/todo-plan/$todoId/$draftId",
            params: { environmentId, todoId: todo.id, draftId: created.draftId },
        });
    };

    const openDetails = (todo: OrchestrationTodo) => {
        if (environmentId === null) return;
        void navigate({ to: "/$environmentId/todos/$todoId", params: { environmentId, todoId: todo.id } });
    };

    return (
        <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
            <main className="mx-auto flex h-full w-full max-w-4xl flex-col gap-6 overflow-y-auto px-6 py-8">
                <header>
                    <h1 className="text-2xl font-semibold">To-dos</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Capture an outcome, then develop its full specification when you are ready.
                    </p>
                </header>

                <section className="rounded-xl border bg-card p-4">
                    <Input
                        value={title}
                        onChange={(event) => setTitle(event.currentTarget.value)}
                        placeholder="What do you want to do?"
                    />
                    <Input
                        className="mt-3"
                        value={summary}
                        onChange={(event) => setSummary(event.currentTarget.value)}
                        placeholder="What will this bring? (short description)"
                    />
                    <div className="mt-3 flex items-center gap-2">
                        <select
                            aria-label="Project"
                            value={projectId ?? ""}
                            onChange={(event) =>
                                setProjectId(
                                    event.currentTarget.value ? (event.currentTarget.value as ProjectId) : null,
                                )
                            }
                            className="h-9 min-w-48 rounded-md border bg-background px-3 text-sm"
                        >
                            <option value="">Inbox (no project)</option>
                            {projects.map((project) => (
                                <option key={project.id} value={project.id}>
                                    {project.title}
                                </option>
                            ))}
                        </select>
                        <Button
                            onClick={() => void addTodo()}
                            disabled={environmentId === null || title.trim().length === 0}
                        >
                            <PlusIcon className="size-4" /> Add
                        </Button>
                    </div>
                </section>

                <div className="space-y-6">
                    {groups.map((group) => (
                        <section key={group.key}>
                            <h2 className="mb-2 text-sm font-medium text-muted-foreground">{group.title}</h2>
                            <div className="divide-y rounded-xl border bg-card">
                                {group.items.map((todo) => {
                                    const subtasks = subtasksByParentId.get(todo.id) ?? [];
                                    const completedSubtasks = subtasks.filter(
                                        (subtask) => subtask.completedAt !== null,
                                    ).length;
                                    return (
                                        <div key={todo.id} className="flex items-center gap-3 p-3 hover:bg-muted/40">
                                            <button
                                                aria-label="Complete to-do"
                                                className="cursor-pointer text-muted-foreground hover:text-foreground"
                                                onClick={() => void setCompleted(todo, true)}
                                            >
                                                {todo.completedAt === null ? (
                                                    <CircleIcon className="size-5" />
                                                ) : (
                                                    <CheckIcon className="size-5" />
                                                )}
                                            </button>
                                            <button
                                                className="min-w-0 flex-1 cursor-pointer text-left"
                                                onClick={() => openDetails(todo)}
                                            >
                                                <div
                                                    className={
                                                        todo.completedAt === null
                                                            ? "font-medium"
                                                            : "font-medium text-muted-foreground line-through"
                                                    }
                                                >
                                                    {todo.title}
                                                </div>
                                                <div className="truncate text-sm text-muted-foreground">
                                                    {todo.summary || "No outcome described yet"}
                                                </div>
                                            </button>
                                            {subtasks.length > 0 ? (
                                                <span className="shrink-0 text-xs text-muted-foreground">
                                                    {completedSubtasks}/{subtasks.length} subtasks
                                                </span>
                                            ) : null}
                                            <Button size="sm" variant="ghost" onClick={() => void startTodo(todo)}>
                                                <PlayIcon className="size-4" /> Start
                                            </Button>
                                            <Button size="sm" variant="ghost" onClick={() => void planTodo(todo)}>
                                                <SparklesIcon className="size-4" /> Plan
                                            </Button>
                                            <Button
                                                size="icon-sm"
                                                variant="ghost"
                                                aria-label="Delete to-do"
                                                onClick={() =>
                                                    environmentId &&
                                                    void remove({ environmentId, input: { todoId: todo.id } })
                                                }
                                            >
                                                <Trash2Icon className="size-4" />
                                            </Button>
                                            <Button
                                                size="icon-sm"
                                                variant="ghost"
                                                aria-label="Open details"
                                                onClick={() => openDetails(todo)}
                                            >
                                                <ChevronRightIcon className="size-4" />
                                            </Button>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    ))}
                    {groups.length === 0 ? (
                        <p className="py-12 text-center text-sm text-muted-foreground">Nothing here yet.</p>
                    ) : null}
                    {completedTodos.length > 0 ? (
                        <section className="pt-2">
                            <h2 className="mb-2 text-sm font-medium text-muted-foreground">Completed</h2>
                            <div className="space-y-1">
                                {completedTodos.map((todo) => (
                                    <div
                                        key={todo.id}
                                        className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/40"
                                    >
                                        <button
                                            className="cursor-pointer text-muted-foreground hover:text-foreground"
                                            aria-label="Reopen to-do"
                                            onClick={() => void setCompleted(todo, false)}
                                        >
                                            <CheckIcon className="size-4" />
                                        </button>
                                        <button
                                            className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm text-muted-foreground line-through"
                                            onClick={() => openDetails(todo)}
                                        >
                                            {todo.title}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </section>
                    ) : null}
                </div>
            </main>
        </SidebarInset>
    );
}
