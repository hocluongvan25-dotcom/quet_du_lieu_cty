"use client";

import { createContext, useContext, type ReactNode } from "react";
import { emptyWorkspace, type WorkspaceSnapshot } from "@/lib/data/workspace-types";

const WorkspaceContext = createContext<WorkspaceSnapshot>(emptyWorkspace);

/**
 * Shares the server-loaded workspace snapshot with client components so every
 * page shows the same credits, account and reports without extra requests.
 */
export function WorkspaceProvider({
  value,
  children,
}: {
  value: WorkspaceSnapshot;
  children: ReactNode;
}) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceSnapshot {
  return useContext(WorkspaceContext);
}
