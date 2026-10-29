<!--
The body template an agent files with:

    gh issue create --title "<symptom as a sentence>" \
      --body-file .github/bug-report-template.md \
      --label bug,needs-triage

Delete the guidance lines as you fill each section in, and keep the headings.
The form a human fills in the browser is `.github/ISSUE_TEMPLATE/bug.yml`; it
asks the same questions. This file is the same shape in a form `gh` can post.

**Where the record lives:** an issue is the record. GitHub Issues tracks planned
work and defects; close an issue with a comment naming the check that ran, not
with a close reason alone.
-->

**What happens**

<!-- The precise symptom, not your diagnosis of it. -->

**Why**

<!-- Root cause with file:line. If you have not established it, write
"cause not established" and say what you have ruled out. That is a complete
answer here, and better than a guess: a guess recorded as a cause sends the
next person to the wrong subsystem. -->

**Why it is not <adjacent subsystem>**

<!-- Name the subsystem a reader would reasonably suspect, and why it is
correct. Skip only if there genuinely is no candidate. This is the section
that stops a completed investigation being repeated. -->

**Evidence**

<!-- Reproduction steps, test names, commits, measurements. -->

**Next pickup action**

<!-- What the next person should do first. If the choice between owners is
itself the open question, say that and list the candidates. Declining to
choose is a valid answer. -->

**Size — why this is an issue and not fixed on the fly**

<!-- Any one of these makes it an issue:
  - the cause is not established
  - more than one owner could fix it
  - the fix needs a design decision
  - it spans subsystems
  - it blocks running work
  - it would need a spec, not a task
All of them being false means it was small: cause named with file:line, the
fix inside one owner, the correct behaviour already specified, an obvious
regression test, and no work lost and no data misrepresented. -->
