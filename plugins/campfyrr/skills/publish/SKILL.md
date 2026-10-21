---
name: publish
description: Publish a plan, test results or a sample output from this session as a Campfyrr page with a link, so teammates and people who don't read code can see it and answer from it.
argument-hint: "[plan | test results | output] [what to publish]"
---

Publish what this session made with the Campfyrr `publish` tool.

1. Work out what to publish from the request ($ARGUMENTS) and the session: the current plan, the latest test run, or a sample of what the code now produces.
2. Write it for someone who doesn't read code first:
   - start with what it is and what it shows, in two or three plain sentences ("All 42 refund tests pass, including partial refunds.");
   - then the detail: the steps, the test output, the sample.
   Leave out secrets, tokens and customer data.
3. Call `publish` with:
   - `project`: the repository's folder name;
   - `kind`: plan, test results or output;
   - a plain `title`;
   - the `content`.
   Use `audience: "anyone with the link"` only if the person asked to share it outside the team.
4. Reply with the link and one line on what it shows, ready to paste into Slack or wherever the conversation is happening.
