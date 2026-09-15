import { useRef } from "react";

/**
 * Plain-language explanation of how the site keeps files private, opened
 * from a button. Uses the native dialog element for focus handling and
 * Escape-to-close.
 */
export function PrivacyDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        className="linklike-button"
        onClick={() => dialogRef.current?.showModal()}
      >
        How does this stay private?
      </button>

      <dialog
        ref={dialogRef}
        className="explainer"
        aria-labelledby="explainer-title"
        onClick={(event) => {
          // Clicking the dimmed backdrop (outside the panel) closes the dialog.
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
      >
        <div className="explainer-panel">
          <div className="explainer-head">
            <h2 id="explainer-title">How this page keeps your file private</h2>
            <button
              type="button"
              className="ghost-button"
              onClick={() => dialogRef.current?.close()}
            >
              Close
            </button>
          </div>

          <h3>Think of it like a calculator, not a form</h3>
          <p>
            Most websites work like a form at a counter. You hand your document to the clerk,
            the clerk takes it into a back room, and a while later you get an answer. Your
            document is now in that back room, and you have to trust what happens to it there.
          </p>
          <p>
            This page works like a calculator you were handed at the door. When you first open
            the page, your browser downloads the calculator: the page itself, its code, and its
            fonts. That download is the only thing that ever travels between your computer and
            ours. From then on, everything happens on your own computer.
          </p>

          <h3>What happens when you drop a log file</h3>
          <p>
            Your browser opens the file from your disk, reads the numbers, does the math, and
            draws the tables, charts, and fluence pictures. All of it happens inside your
            browser tab. The file never leaves your computer. There is no back room. There is
            no server that receives it. We could not see your file even if we wanted to.
          </p>

          <h3>We did not just promise this, we checked it</h3>
          <p>
            Three things make this true, and each one can be checked by anyone.
          </p>
          <ol>
            <li>
              <strong>The code has no way to send anything.</strong> There is simply no
              upload code in this site. Every time we publish a new version, an automatic check
              scans the finished code for anything that could talk to the internet, and refuses
              to publish if it finds any.
            </li>
            <li>
              <strong>The browser is told to block it anyway.</strong> The page carries a
              security rule (a Content Security Policy) that instructs your browser to refuse
              any outgoing connection from this page. Even if a mistake slipped into the code
              someday, your browser would stop it.
            </li>
            <li>
              <strong>We watched the network while it ran.</strong> We loaded the live site,
              turned on the browser's network monitor, and ran a full analysis. The monitor
              recorded zero requests. Then we went further: we cut the internet connection
              completely and ran the analysis again. It worked exactly the same, because it
              never needed the internet in the first place.
            </li>
          </ol>

          <h3>Try it yourself</h3>
          <p>
            Open this page, then turn off your Wi-Fi or unplug the network cable. Drop a log
            file. Everything still works. That is the simplest proof there is: a page that has
            no connection cannot send anything anywhere.
          </p>

          <h3>One honest caveat</h3>
          <p>
            The calculator has to be picked up once. If you refresh the page while you are
            offline, your browser will try to download the page again, cannot reach the
            internet, and will show an error. This has nothing to do with your file. It just
            means the page itself needs an internet connection to open, the same way a
            calculator has to be handed to you before you can use it. Once it is open, you can
            stay offline as long as you like.
          </p>

          <h3>What about the patient identifiers on screen?</h3>
          <p>
            The log file contains a patient ID and plan identifiers. We show them hidden by
            default, so nothing sensitive appears if you are sharing your screen. Clicking
            "Show identifiers" reveals them to you, and only to you, on your own screen. The
            CSV export never includes them.
          </p>
        </div>
      </dialog>
    </>
  );
}
