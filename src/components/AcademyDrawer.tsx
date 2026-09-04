/**
 * The courses, beside the work rather than over it.
 *
 * A drawer for the same reason the help is one, and more so: a lesson that
 * takes over the screen cannot teach a tool, because the tool is not on the
 * screen any more. Everything here is written to be read with the letter still
 * in front of you, and the lesson you are on stays open while you go and do it.
 *
 * The checked lessons are the point of the whole thing. A lesson that asks the
 * document goes green when the document says so and cannot be pressed; one that
 * cannot be asked -- read this, look at that -- is marked by hand and is drawn
 * differently, because those are two different claims and showing them the same
 * way would be a lie about which you had.
 */

import * as React from "react";
import { CheckCircleIcon, CircleIcon, CircleDashedIcon } from "@phosphor-icons/react";

import { COURSES, type Course, type Lesson, type Progressed } from "@/academy/courses";
import {
  forgetProgress,
  isMarked,
  markLesson,
  markedLessons,
  subscribeToProgress,
} from "@/academy/progress";
import { useAppState } from "@/state/useStore";
import { useForge } from "@/state/useForge";
import { cn } from "@/ui/lib/utils";

export function AcademyDrawer({
  mode,
  onClose,
  onGo,
}: {
  mode: string;
  onClose: () => void;
  /** Take the reader to where the lesson happens. */
  onGo: (where: { mode?: string; view?: string }) => void;
}): React.JSX.Element {
  const app = useAppState();
  const forge = useForge();
  React.useSyncExternalStore(subscribeToProgress, markedLessons, () => markedLessons());

  const [open, setOpen] = React.useState<string | null>(COURSES[0]?.id ?? null);

  const at: Progressed = { app, forge, mode };

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const done = (lesson: Lesson): boolean => (lesson.done ? lesson.done(at) : isMarked(lesson.id));
  const countDone = (course: Course) => course.lessons.filter(done).length;
  const finished = COURSES.reduce((total, one) => total + countDone(one), 0);
  const all = COURSES.reduce((total, one) => total + one.lessons.length, 0);

  return (
    <aside
      role="dialog"
      aria-label="Type Academy"
      data-academy
      className="toolcraft-panel-surface flex w-96 shrink-0 flex-col border-l border-border"
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="text-xs-plus font-medium">Type Academy</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Type Academy"
          className="rounded px-2 py-1 text-2xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        >
          Close
        </button>
      </div>

      <div className="shrink-0 border-b border-border px-4 py-3">
        <p className="text-2xs leading-snug text-muted-foreground">
          Four courses on making type, each one done in the tool rather than read about. Most
          lessons check themselves against the font you are actually making.
        </p>
        <p className="pt-2 text-2xs text-muted-foreground" data-academy-progress>
          <span className="font-medium text-foreground">{finished}</span> of {all} lessons done
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {COURSES.map((course) => (
          <CourseBlock
            key={course.id}
            course={course}
            open={open === course.id}
            onOpen={() => setOpen(open === course.id ? null : course.id)}
            done={done}
            doneCount={countDone(course)}
            onGo={onGo}
          />
        ))}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <button
          type="button"
          onClick={forgetProgress}
          data-academy-reset
          className="rounded border border-border px-2 py-1 text-2xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        >
          Start the courses again
        </button>
        {/*
          Only the hand-marked ones are forgotten, and saying so matters: a
          lesson the font answers goes back to done the moment this is pressed,
          because the font still says so. Nothing here can un-draw your work.
        */}
        <p className="pt-2 text-2xs leading-snug text-muted-foreground">
          Clears what you marked by hand. The lessons the font answers stay done, because the font
          still says so.
        </p>
      </div>
    </aside>
  );
}

function CourseBlock({
  course,
  open,
  onOpen,
  done,
  doneCount,
  onGo,
}: {
  course: Course;
  open: boolean;
  onOpen: () => void;
  done: (lesson: Lesson) => boolean;
  doneCount: number;
  onGo: (where: { mode?: string; view?: string }) => void;
}): React.JSX.Element {
  const complete = doneCount === course.lessons.length;
  return (
    <section className="pb-1" data-course={course.id}>
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        className="flex w-full items-baseline gap-2 rounded px-2 py-2 text-left transition-colors hover:bg-card"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-2xs font-medium text-foreground">{course.title}</span>
          <span className="block pt-0.5 text-2xs leading-snug text-muted-foreground">
            {course.about}
          </span>
        </span>
        <span
          className={cn(
            "shrink-0 tabular-nums text-2xs",
            complete ? "text-[color:var(--attention)]" : "text-muted-foreground",
          )}
        >
          {doneCount}/{course.lessons.length}
        </span>
      </button>

      {open && (
        <ol className="pb-2">
          {course.lessons.map((lesson, at) => (
            <LessonBlock
              key={lesson.id}
              lesson={lesson}
              number={at + 1}
              done={done(lesson)}
              onGo={onGo}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function LessonBlock({
  lesson,
  number,
  done,
  onGo,
}: {
  lesson: Lesson;
  number: number;
  done: boolean;
  onGo: (where: { mode?: string; view?: string }) => void;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const checked = Boolean(lesson.done);

  return (
    <li className="px-2" data-lesson={lesson.id} data-done={done ? "yes" : "no"}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 rounded px-1.5 py-1.5 text-left transition-colors hover:bg-card"
      >
        {/*
          Three marks, not two. A filled tick is the font saying so; a hollow
          one is you saying so; a dashed ring is a lesson whose answer is in the
          font and is not yet true. The difference between the first two is the
          difference between evidence and assertion.
        */}
        {done ? (
          <CheckCircleIcon
            size={14}
            weight={checked ? "fill" : "regular"}
            className="mt-[1px] shrink-0 text-[color:var(--attention)]"
          />
        ) : checked ? (
          <CircleDashedIcon size={14} className="mt-[1px] shrink-0 text-muted-foreground" />
        ) : (
          <CircleIcon size={14} className="mt-[1px] shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-2xs",
              done ? "text-muted-foreground line-through" : "text-foreground",
            )}
          >
            {number}. {lesson.title}
          </span>
        </span>
      </button>

      {open && (
        <div className="pb-2 pl-6 pr-1">
          {lesson.teaches.split("\n\n").map((para, at) => (
            <p key={at} className="pb-2 text-2xs leading-relaxed text-muted-foreground">
              {para}
            </p>
          ))}

          <p className="pb-2 text-2xs leading-snug">
            <span className="font-medium text-foreground">Do this. </span>
            <span className="text-muted-foreground">{lesson.task}</span>
          </p>

          <div className="flex flex-wrap items-center gap-1.5">
            {lesson.where && (
              <button
                type="button"
                onClick={() => onGo(lesson.where!)}
                data-lesson-go
                className="rounded border border-border px-1.5 py-1 text-2xs text-muted-foreground transition-colors hover:border-accent hover:text-foreground"
              >
                Take me there
              </button>
            )}
            {!checked && (
              <button
                type="button"
                onClick={() => markLesson(lesson.id, !done)}
                data-lesson-mark
                className="rounded border border-border px-1.5 py-1 text-2xs text-muted-foreground transition-colors hover:border-accent hover:text-foreground"
              >
                {done ? "Not done after all" : "Mark as read"}
              </button>
            )}
            {checked && !done && (
              <span className="text-2xs text-muted-foreground">
                This one ticks itself when the font says so.
              </span>
            )}
          </div>

          {done && lesson.learned && (
            <p className="pt-2 text-2xs leading-snug text-[color:var(--attention)]">
              {lesson.learned}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
