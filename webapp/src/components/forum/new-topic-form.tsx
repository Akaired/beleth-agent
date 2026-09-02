"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { createTopicAction } from "@/lib/forum/actions";
import type { ForumActionState } from "@/lib/forum/types";
import { TITLE_MAX } from "@/lib/forum/limits";
import { RichEditor } from "@/components/forum/rich-editor";
import { DemoNameDialog } from "@/components/forum/demo-name-dialog";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-acc/15 px-4 py-1.5 text-[12px] text-acc transition-colors hover:bg-acc/25 disabled:opacity-50"
    >
      {pending ? "Creating…" : "Create topic"}
    </button>
  );
}

export function NewTopicForm({
  categories,
  defaultCategory,
  isDemo = false,
}: {
  categories: { slug: string; name: string }[];
  defaultCategory?: string;
  isDemo?: boolean;
}) {
  const [state, formAction] = useActionState<ForumActionState, FormData>(
    createTopicAction,
    { error: null },
  );
  const formRef = useRef<HTMLFormElement>(null);
  const aliasRef = useRef<HTMLInputElement>(null);
  // Gate every demo submit through the name modal — re-armed after each post.
  const [askName, setAskName] = useState(false);
  const passRef = useRef(false);

  const initialCategory =
    defaultCategory && categories.some((c) => c.slug === defaultCategory)
      ? defaultCategory
      : categories[0]?.slug;

  const fieldLabel =
    "font-mono text-[10px] uppercase tracking-[0.08em] text-sec";
  const fieldBox =
    "w-full rounded border border-inputline bg-inset px-3 py-2 text-[13px] text-txt outline-none transition-colors focus:border-hoverline";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (!isDemo || passRef.current) {
      passRef.current = false;
      return;
    }
    e.preventDefault();
    setAskName(true);
  }

  return (
    <>
      <form
        ref={formRef}
        action={formAction}
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded-md border border-line bg-panel p-4"
      >
        {isDemo && (
          <input ref={aliasRef} type="hidden" name="author_name" defaultValue="" />
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="forum-new-category" className={fieldLabel}>
            Category
          </label>
          <select
            id="forum-new-category"
            name="category"
            defaultValue={initialCategory}
            className={fieldBox}
          >
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="forum-new-title" className={fieldLabel}>
            Title
          </label>
          <input
            id="forum-new-title"
            name="title"
            type="text"
            required
            minLength={3}
            maxLength={TITLE_MAX}
            placeholder="A clear, specific title"
            className={fieldBox}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className={fieldLabel}>Body</span>
          <RichEditor
            name="body"
            placeholder="Write your post…"
            minHeight={200}
            allowImages={!isDemo}
          />
        </div>

        {state?.error && (
          <p className="text-[11.5px] text-down">{state.error}</p>
        )}

        <div className="flex justify-end">
          <SubmitButton />
        </div>
      </form>

      {isDemo && (
        <DemoNameDialog
          open={askName}
          onConfirm={(name) => {
            if (aliasRef.current) aliasRef.current.value = name;
            passRef.current = true;
            setAskName(false);
            formRef.current?.requestSubmit();
          }}
          onCancel={() => setAskName(false)}
        />
      )}
    </>
  );
}
