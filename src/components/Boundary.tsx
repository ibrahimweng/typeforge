/**
 * What is on screen when the drawing cannot be drawn.
 *
 * React unmounts the whole tree when a render throws, and the page underneath
 * this application is very nearly black -- so without something to catch it,
 * every fault of every kind looks identical from the outside: a black screen,
 * no message, nothing to press, and no way to tell a broken build from a broken
 * document from a browser that is simply too old.
 *
 * That is not a hypothetical. A part was added to the drawing as a required
 * field and the code that reads old documents was not told about it, so anybody
 * who had opened the page before that day had a document in their browser
 * without it. The first letter drawn read `undefined.on` and threw, and the
 * application went black. The fault took a minute to fix and most of an
 * afternoon to find, because the screen said nothing at all.
 *
 * So this says what happened, and offers the one thing that gets a person
 * moving again: start over without the document that will not open. That is
 * deliberately not automatic. Somebody's work is in there, and throwing it away
 * to make an error go away is a decision for them and not for this.
 */

import * as React from "react";

interface Props {
  children: React.ReactNode;
  /**
   * Wipe the kept session, for when it is the document that will not open.
   *
   * Returns a promise and it is waited for. Throwing the work away is a
   * transaction against a database this page is about to be navigated away
   * from, and reloading without waiting cancels it -- which was how this was
   * written first, and it made the one button here does nothing at all: the
   * page came back with the same document in it and threw again.
   */
  onDiscard?: () => Promise<void> | void;
}

interface State {
  error: Error | null;
}

export class Boundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // To the console as well, because the person who can act on a stack trace
    // is usually not the person looking at the screen.
    console.error("Typeforge stopped:", error, info.componentStack);
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
        <div className="max-w-lg space-y-4">
          <h1 className="text-lg font-semibold">Typeforge stopped</h1>
          <p className="text-sm text-muted-foreground">
            Something went wrong while drawing. This is a fault in the application rather than
            anything you did.
          </p>
          <pre className="max-h-40 overflow-auto rounded border border-border bg-muted/40 p-3 text-2xs leading-relaxed">
            {/*
              * Whatever was thrown, not whatever an Error would have said.
              *
              * React hands this back exactly as it was thrown, and nothing
              * obliges a library to throw an Error -- so reading `.message` off
              * a thrown string leaves this box empty, which is the same
              * silence the whole component exists to break.
              */}
            {error instanceof Error ? error.message : String(error)}
          </pre>
          <p className="text-sm text-muted-foreground">
            Reloading is worth trying first. If it stops again in the same place, the work kept in
            this browser is the likely cause and clearing it will get you moving -- though it does
            mean losing whatever was in it, so export anything you still want first if you can.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              Reload
            </button>
            {this.props.onDiscard ? (
              <button
                type="button"
                onClick={() => {
                  // Waited for, then reloaded. See `onDiscard`.
                  void Promise.resolve(this.props.onDiscard?.()).then(() => {
                    window.location.reload();
                  });
                }}
                className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted"
              >
                Clear the kept work and reload
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
}
