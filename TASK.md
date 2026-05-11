I want to build a solution for md-based memory for AI agents.

I consider adding sqlite for easier catalogization. And maybe adding embeddings and vector search if possible to do it locally with sqlite (I am not sure about embeddings model, if it possible to find a reasanoble open model that can run reasonably fast on modern macbooks).

I want to wrap it all into a cli, so memory database can live somewhere in user folder ~/.ai-memory, and globally installed cli provides the access and control commands to it. And we write a skill for agents so they know how to use that cli, how to use the memory, enrich it, update, search etc.

Here's the existing repos I found that are implementing partially what I want

https://github.com/sqliteai/sqlite-memory
https://github.com/zilliztech/memsearch

https://www.reddit.com/r/ObsidianMD/comments/1l9rdnb/basic_memory_obsidian_ai_that_reads_writes_and/

https://github.com/jrcruciani/obsidian-memory-for-ai

https://dev.to/oracledevs/agent-memory-why-your-ai-has-amnesia-and-how-to-fix-it-475e?customTrackingParam=:ad:vd:yt:awr:a_nas::RC_DEVT260304P00029:Omer

Obsidian CLI is interesting to research as well, we may use it as well.


What operations I want it to support:

- ingest new data: I want to be able to give agent new data as a file or as a plain text message, so the agent can analyze it, find proper place where it belongs, create or update MD there, lint all the links etc.

- search for information: I want to be able to request something, and agent must be able to retrieve data from the memory using reasonable small amount of tokens.

The CLI may have some helper methods:
- scan all the MDs and verify there is no stale links, or orphaned docs, provide the report
- use index.md or sqlite for indexing
- anything else that is formalizable so we can fastly compute it with cli, not offloading for slow AI analysis


Approach:

phase 1 - research:
the existing solutions must be researched, and the whole paradigm if MD + obsidian, indexing, linting, retrieving etc - must be researched and understood.

Questions: 
- are there already solutions that fulfill my needs, I can just use right away?
- if no, does the approach I suggested make any sense?

phase 2 - solution design
need to design the solution
- CLI layer - what it does, the scope, the list of commands
- MD files structure, linking, linting
- sqlite role, the scope, the usage
- embeddings and vector search? any feasible stable solutions to use or drop this idea completely?

phase 3 - implementation planning
need to split solution design in manageable steps to offload to subagents
prepare the stepped plan with verbose description and prompt for subagents for each step with enough context

phase 4 - implementation drill
spin subagents sequentially for each step.
after each step run subagent with "simplify" skill
after it review and commit the step.
repeat for all the steps.

phase 5 - extensive testing

phase 6 - skill/agents
create skill for using the built CLI using "skill-creator" skill in ./skills dir of this repo.
agents may be benefitial to define for this system as well, maybe some cheaper model agents can handle some errunds for us. Woth researching.


Stack and tech:
use nodejs 22 or 24
use pnpm as package manager
use moostjs cli as cli framework
use atscript and atscript-db as DSL and DB access layer for sqlite

The relevant skills for moostjs and atscript are loaded.
