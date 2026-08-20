"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { Folder } from "@/lib/content";
import styles from "./FolderTree.module.css";

export type FolderTreeProps = {
  folders: Folder[];
  activePath: string | null;
  countsByPath?: Record<string, number>;
  onNavigate: (path: string) => void;
  onCreateSubfolder: (parentPath: string, name: string) => Promise<void>;
};

type TreeNode = {
  folder: Folder;
  children: TreeNode[];
};

const MAX_DEPTH = 4;

function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function compareFoldersByName(a: Folder, b: Folder): number {
  return a.name.localeCompare(b.name, undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function buildTree(folders: Folder[]): TreeNode[] {
  const childrenByParent = new Map<string | null, Folder[]>();

  for (const folder of folders) {
    const parentId = folder.parentId ?? null;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(folder);
    childrenByParent.set(parentId, siblings);
  }

  const materialize = (folder: Folder): TreeNode => {
    const children = (childrenByParent.get(folder.id) ?? [])
      .slice()
      .sort(compareFoldersByName)
      .map(materialize);
    return { folder, children };
  };

  return (childrenByParent.get(null) ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(materialize);
}

function rootIds(tree: TreeNode[]): string[] {
  return tree.map((node) => node.folder.id);
}

function activeAncestorIds(folders: Folder[], activePath: string | null): string[] {
  if (!activePath) return [];

  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const byPath = new Map(folders.map((folder) => [folder.path, folder]));
  const active = byPath.get(activePath);
  const ancestors: string[] = [];
  let parentId = active?.parentId ?? null;

  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent) break;
    ancestors.push(parent.id);
    parentId = parent.parentId ?? null;
  }

  return ancestors;
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 18 16" aria-hidden="true">
      <path
        d="M2.25 4.25c0-.83.67-1.5 1.5-1.5h3.28c.45 0 .88.2 1.16.55l.74.9h5.32c.83 0 1.5.67 1.5 1.5v6.55c0 .83-.67 1.5-1.5 1.5H3.75c-.83 0-1.5-.67-1.5-1.5v-8Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.45"
      />
    </svg>
  );
}

function DisclosureIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M4.5 2.75 8 6l-3.5 3.25"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function FolderTree({
  folders,
  activePath,
  countsByPath,
  onNavigate,
  onCreateSubfolder,
}: FolderTreeProps) {
  const tree = useMemo(() => buildTree(folders), [folders]);
  const folderByPath = useMemo(
    () => new Map(folders.map((folder) => [folder.path, folder])),
    [folders],
  );
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set([...rootIds(tree), ...activeAncestorIds(folders, activePath)]),
  );
  const [creatingParentPath, setCreatingParentPath] = useState<string | null>(
    null,
  );
  const [draftName, setDraftName] = useState("");
  const [savingParentPath, setSavingParentPath] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const idsToOpen = [
        ...rootIds(tree),
        ...activeAncestorIds(folders, activePath),
      ];
      setOpenIds((current) => new Set([...current, ...idsToOpen]));
    });
    return () => {
      active = false;
    };
  }, [activePath, folders, tree]);

  const toggleOpen = useCallback((folderId: string) => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const startCreate = useCallback((folder: Folder) => {
    setOpenIds((current) => new Set([...current, folder.id]));
    setCreatingParentPath(folder.path);
    setDraftName("");
    setCreateError(null);
  }, []);

  const cancelCreate = useCallback(() => {
    setCreatingParentPath(null);
    setDraftName("");
    setCreateError(null);
  }, []);

  const commitCreate = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!creatingParentPath || savingParentPath) return;

      const name = draftName.trim();
      if (!name) {
        setCreateError("Enter a folder name.");
        return;
      }

      setSavingParentPath(creatingParentPath);
      setCreateError(null);

      try {
        await onCreateSubfolder(creatingParentPath, name);
        const parent = folderByPath.get(creatingParentPath);
        if (parent) setOpenIds((current) => new Set([...current, parent.id]));
        setCreatingParentPath(null);
        setDraftName("");
      } catch (createErrorValue) {
        setCreateError(errorMessage(createErrorValue, "Could not create folder."));
      } finally {
        setSavingParentPath(null);
      }
    },
    [
      creatingParentPath,
      draftName,
      folderByPath,
      onCreateSubfolder,
      savingParentPath,
    ],
  );

  const onCreateKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelCreate();
    },
    [cancelCreate],
  );

  const renderNode = (node: TreeNode, depth: number) => {
    const { folder } = node;
    const withinDepth = depth < MAX_DEPTH;
    const hasChildren = withinDepth && node.children.length > 0;
    const open = openIds.has(folder.id);
    const active = activePath === folder.path;
    const count = countsByPath?.[folder.path] ?? 0;
    const creatingHere = creatingParentPath === folder.path;
    const savingHere = savingParentPath === folder.path;
    const rowStyle = {
      "--folder-indent": `${(depth - 1) * 16}px`,
    } as CSSProperties;

    return (
      <li className={styles.item} key={folder.id}>
        <div
          className={classNames(styles.row, active && styles.activeRow)}
          style={rowStyle}
        >
          {hasChildren ? (
            <button
              className={styles.disclosureButton}
              type="button"
              aria-label={open ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
              aria-expanded={open}
              onClick={() => toggleOpen(folder.id)}
            >
              <span
                className={classNames(
                  styles.disclosureIcon,
                  open && styles.disclosureIconOpen,
                )}
              >
                <DisclosureIcon />
              </span>
            </button>
          ) : (
            <span className={styles.disclosureSpacer} aria-hidden="true" />
          )}

          <button
            className={styles.folderButton}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onNavigate(folder.path)}
          >
            <span className={styles.folderIcon} aria-hidden="true">
              <FolderIcon />
            </span>
            <span className={styles.folderName}>{folder.name}</span>
          </button>

          {count > 0 && <span className={styles.count}>{count}</span>}

          {withinDepth && (
            <button
              className={styles.addButton}
              type="button"
              aria-label={`Create subfolder in ${folder.name}`}
              onClick={() => startCreate(folder)}
            >
              +
            </button>
          )}
        </div>

        {creatingHere && (
          <form
            className={styles.createRow}
            style={rowStyle}
            onSubmit={commitCreate}
          >
            <span className={styles.createSpacer} aria-hidden="true" />
            <input
              className={styles.createInput}
              value={draftName}
              placeholder="New folder"
              autoFocus
              disabled={savingHere}
              aria-label={`New subfolder name in ${folder.name}`}
              onChange={(event) => setDraftName(event.currentTarget.value)}
              onKeyDown={onCreateKeyDown}
            />
            <button
              className={styles.createButton}
              type="submit"
              disabled={savingHere || !draftName.trim()}
            >
              {savingHere ? "Creating" : "Create"}
            </button>
            {createError && (
              <div className={styles.createError} role="status">
                {createError}
              </div>
            )}
          </form>
        )}

        {hasChildren && open && (
          <ul className={styles.list}>
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  if (tree.length === 0) {
    return (
      <nav className={`applecms ${styles.root}`} aria-label="Folders">
        <div className={styles.emptyState}>No folders</div>
      </nav>
    );
  }

  return (
    <nav className={`applecms ${styles.root}`} aria-label="Folders">
      <ul className={styles.list}>{tree.map((node) => renderNode(node, 1))}</ul>
    </nav>
  );
}

export default FolderTree;
