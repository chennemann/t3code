import { useAtomValue } from "@effect/atom-react";
import { randomUUID } from "../lib/utils";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import type {
  CreateTodoInput,
  UpdateTodoInput,
  DeleteTodoInput,
} from "@t3tools/client-runtime/operations";
import { CommandId, TodoId, WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import { connectionAtomRuntime } from "../connection/runtime";
import { useAtomCommand } from "./use-atom-command";

export const todoCommands = {
  dispatch: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:commands:todo:dispatch",
    tag: WS_METHODS.todosDispatch,
  }),
};

export function useTodoCommands(environmentId: EnvironmentId | null) {
  const canOperate = useAtomValue(todoCommands.dispatch.permissionAtom(environmentId));
  const dispatch = useAtomCommand(todoCommands.dispatch);
  return {
    canOperate,
    create: ({ environmentId, input }: { environmentId: EnvironmentId; input: CreateTodoInput }) =>
      dispatch({
        environmentId,
        input: {
          ...input,
          type: "todo.create",
          todoId: input.todoId ?? TodoId.make(randomUUID()),
          commandId: input.commandId ?? CommandId.make(randomUUID()),
          createdAt: input.createdAt ?? new Date().toISOString(),
        },
      }),
    update: ({ environmentId, input }: { environmentId: EnvironmentId; input: UpdateTodoInput }) =>
      dispatch({
        environmentId,
        input: {
          ...input,
          type: "todo.update",
          commandId: input.commandId ?? CommandId.make(randomUUID()),
        },
      }),
    remove: ({ environmentId, input }: { environmentId: EnvironmentId; input: DeleteTodoInput }) =>
      dispatch({
        environmentId,
        input: {
          ...input,
          type: "todo.delete",
          commandId: input.commandId ?? CommandId.make(randomUUID()),
        },
      }),
  };
}
