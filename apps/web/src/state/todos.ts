import { createEnvironmentCommand } from "@t3tools/client-runtime/state/runtime";
import {
  createTodo,
  deleteTodo,
  updateTodo,
  type CreateTodoInput,
  type DeleteTodoInput,
  type UpdateTodoInput,
} from "@t3tools/client-runtime/operations";

import { connectionAtomRuntime } from "../connection/runtime";

export const todoCommands = {
  create: createEnvironmentCommand(connectionAtomRuntime, {
    label: "environment-data:commands:todo:create",
    execute: (input: CreateTodoInput) => createTodo(input),
  }),
  update: createEnvironmentCommand(connectionAtomRuntime, {
    label: "environment-data:commands:todo:update",
    execute: (input: UpdateTodoInput) => updateTodo(input),
  }),
  delete: createEnvironmentCommand(connectionAtomRuntime, {
    label: "environment-data:commands:todo:delete",
    execute: (input: DeleteTodoInput) => deleteTodo(input),
  }),
};
