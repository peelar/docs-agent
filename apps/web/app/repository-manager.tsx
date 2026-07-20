"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  BookOpenIcon,
  CheckIcon,
  GitBranchIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface RepositoryState {
  configured: boolean;
  repository?: string;
  evidenceRepositories?: string[];
  updatedAt?: string;
}

type Editor =
  | { kind: "documentation" }
  | { kind: "evidence"; repository?: string };

export function RepositoryManager() {
  const [repository, setRepository] = useState<RepositoryState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let active = true;

    void fetch("/api/repository", { cache: "no-store" })
      .then(async (response) => {
        const payload = await readResponse(response);
        if (!response.ok) throw new Error(payload.error);
        if (!active) return;

        setRepository(payload);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(errorMessage(error));
      });

    return () => {
      active = false;
    };
  }, []);

  function openEditor(nextEditor: Editor) {
    setEditor(nextEditor);
    setRepositoryUrl(
      "repository" in nextEditor && nextEditor.repository
        ? githubUrl(nextEditor.repository)
        : nextEditor.kind === "documentation" && repository?.repository
          ? githubUrl(repository.repository)
          : "",
    );
    setSaveError(null);
  }

  function closeEditor() {
    if (isSaving) return;
    setEditor(null);
    setRepositoryUrl("");
    setSaveError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editor === null) return;

    setIsSaving(true);
    setSaveError(null);

    try {
      const response = await fetch("/api/repository", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: editor.kind,
          repositoryUrl,
          previousRepository:
            editor.kind === "evidence" ? editor.repository : undefined,
        }),
      });
      const payload = await readResponse(response);
      if (!response.ok) throw new Error(payload.error);

      setRepository(payload);
      setEditor(null);
      setRepositoryUrl("");
    } catch (error) {
      setSaveError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  const evidenceRepositories = repository?.evidenceRepositories ?? [];

  return (
    <section className="min-h-svh bg-[#fafafa]" aria-labelledby="repository-title">
      <div className="border-b bg-background px-5 py-4 sm:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-sm font-medium">Repositories</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Configure the sources Paige maintains and reads.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
        <div>
          <div className="max-w-xl">
            <div className="mb-4 flex size-10 items-center justify-center rounded-lg border bg-background shadow-xs">
              <GitBranchIcon className="size-5" />
            </div>
            <h1 id="repository-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              GitHub repositories
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Paige writes documentation to one repository and reads the others
              for evidence.
            </p>
            {loadError ? (
              <p className="mt-3 text-sm text-destructive" role="alert">{loadError}</p>
            ) : null}
          </div>

          <div className="mt-10 overflow-hidden rounded-xl border bg-background shadow-xs">
            <div className="divide-y">
              {editor?.kind === "documentation" ? (
                <InlineRepositoryEditor
                  avatar={<DocumentationAvatar />}
                  isSaving={isSaving}
                  onCancel={closeEditor}
                  onChange={setRepositoryUrl}
                  onSubmit={submit}
                  saveError={saveError}
                  submitLabel={repository?.configured ? "Save change" : "Connect"}
                  value={repositoryUrl}
                />
              ) : repository?.configured && repository.repository ? (
                <DocumentationRow
                  onEdit={() => openEditor({ kind: "documentation" })}
                  repository={repository.repository}
                />
              ) : (
                <AddRepositoryRow
                  disabled={repository === null && loadError === null}
                  label="Connect documentation repository"
                  onClick={() => openEditor({ kind: "documentation" })}
                />
              )}

              {repository?.configured ? (
                <>
                  <p className="bg-muted/40 px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:px-6">
                    Evidence · read-only
                  </p>
                  {evidenceRepositories.map((evidenceRepository) =>
                    editor?.kind === "evidence" &&
                        editor.repository === evidenceRepository ? (
                      <InlineRepositoryEditor
                        avatar={<EvidenceAvatar />}
                        isSaving={isSaving}
                        key={evidenceRepository}
                        onCancel={closeEditor}
                        onChange={setRepositoryUrl}
                        onSubmit={submit}
                        saveError={saveError}
                        submitLabel="Save change"
                        value={repositoryUrl}
                      />
                    ) : (
                      <EvidenceRow
                        key={evidenceRepository}
                        onEdit={() => openEditor({
                          kind: "evidence",
                          repository: evidenceRepository,
                        })}
                        repository={evidenceRepository}
                      />
                    )
                  )}
                  {editor?.kind === "evidence" && editor.repository === undefined ? (
                    <InlineRepositoryEditor
                      avatar={<EvidenceAvatar dashed />}
                      isSaving={isSaving}
                      onCancel={closeEditor}
                      onChange={setRepositoryUrl}
                      onSubmit={submit}
                      saveError={saveError}
                      submitLabel="Add repository"
                      value={repositoryUrl}
                    />
                  ) : (
                    <AddRepositoryRow
                      label="Add evidence repository"
                      onClick={() => openEditor({ kind: "evidence" })}
                    />
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function DocumentationAvatar() {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
      <SquarePenIcon className="size-4" />
    </span>
  );
}

function EvidenceAvatar({ dashed = false }: { dashed?: boolean }) {
  return (
    <span
      className={`flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background ${
        dashed ? "border-dashed text-muted-foreground" : ""
      }`}
    >
      <BookOpenIcon className="size-4" />
    </span>
  );
}

function DocumentationRow({
  onEdit,
  repository,
}: {
  onEdit: () => void;
  repository: string;
}) {
  return (
    <div className="group flex items-center gap-3 px-5 py-4 sm:px-6">
      <DocumentationAvatar />
      <div className="min-w-0 flex-1">
        <RepositoryName onEdit={onEdit} repository={repository} />
        <p className="text-xs text-muted-foreground">
          Paige writes documentation here
        </p>
      </div>
    </div>
  );
}

function EvidenceRow({
  onEdit,
  repository,
}: {
  onEdit: () => void;
  repository: string;
}) {
  return (
    <div className="group flex items-center gap-3 px-5 py-3 sm:px-6">
      <EvidenceAvatar />
      <div className="min-w-0 flex-1">
        <RepositoryName onEdit={onEdit} repository={repository} />
      </div>
    </div>
  );
}

function RepositoryName({
  onEdit,
  repository,
}: {
  onEdit: () => void;
  repository: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        aria-label={`Edit ${repository}`}
        className="max-w-full truncate rounded-sm text-left text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onEdit}
        type="button"
      >
        {repository}
      </button>
      <Button
        aria-label={`Edit ${repository}`}
        className="shrink-0 text-muted-foreground opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
        onClick={onEdit}
        size="icon-xs"
        variant="ghost"
      >
        <PencilIcon />
      </Button>
    </div>
  );
}

function AddRepositoryRow({
  disabled = false,
  label,
  onClick,
}: {
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex w-full items-center gap-3 px-5 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:px-6"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span className="flex size-9 items-center justify-center rounded-lg border border-dashed bg-background">
        <PlusIcon className="size-4" />
      </span>
      {label}
    </button>
  );
}

function InlineRepositoryEditor({
  avatar,
  isSaving,
  onCancel,
  onChange,
  onSubmit,
  saveError,
  submitLabel,
  value,
}: {
  avatar: ReactNode;
  isSaving: boolean;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saveError: string | null;
  submitLabel: string;
  value: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <form className="bg-muted/25 px-5 py-3 sm:px-6" onSubmit={onSubmit}>
      <div className="flex items-center gap-3">
        {avatar}
        <Input
          aria-label="GitHub repository URL"
          autoComplete="url"
          className="h-9 flex-1 bg-background"
          disabled={isSaving}
          name="repositoryUrl"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
          placeholder="https://github.com/owner/repository"
          ref={inputRef}
          required
          spellCheck={false}
          type="url"
          value={value}
        />
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            aria-label={submitLabel}
            disabled={isSaving}
            size="icon-sm"
            title={submitLabel}
            type="submit"
          >
            {isSaving
              ? <LoaderCircleIcon className="animate-spin" />
              : <CheckIcon />}
          </Button>
          <Button
            aria-label="Cancel editing"
            disabled={isSaving}
            onClick={onCancel}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <XIcon />
          </Button>
        </div>
      </div>
      {saveError ? (
        <p className="mt-2 pl-12 text-xs leading-5 text-destructive" role="alert">
          {saveError}
        </p>
      ) : null}
    </form>
  );
}

function githubUrl(repository: string): string {
  return `https://github.com/${repository}`;
}

async function readResponse(
  response: Response,
): Promise<RepositoryState & { error: string }> {
  return await response.json() as RepositoryState & { error: string };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Repository setup failed.";
}
