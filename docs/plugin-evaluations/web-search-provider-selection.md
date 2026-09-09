# Web search provider selection

- Date: 2026-09-10
- Author: maintainer session (evaluate-dsh-plugin skill)
- Decision: reference

## Survey

This supplements [the Web contract evaluation](web-lookup-extraction.md).
Queries included npm `dsh web search`, `dsh brave tavily`, and `dsh vision`,
the [GitHub topic](https://github.com/topics/dsh-plugin), the
[curated list](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin),
the locked official Web packages, and published candidate tarballs.
Downloads below were observed on 2026-09-10 for 2026-08-08 through 2026-09-06;
they measure downloads, not active installations or security assurance.

| Package | Version | License | Downloads/mo (2026-09-10) | Last publish | Repository |
| ------- | ------- | ------- | ----------------------- | ------------ | ---------- |
| `@deepseek-ai/dsh-web-search-exa` | 0.0.1-rc.1 | BSD-3-Clause | 9,020 | 2026-08-10 | [official](https://github.com/deepseek-ai/deepseek-harness) |
| `dsh-web-search-pro` | 0.1.11 | MIT | 7,409 | 2026-08-25 | [source](https://github.com/anweat/dsh-web-search-pro) |
| `dsh-web-search-aggregation` | 0.1.10 | MIT | 2,096 | 2026-08-24 | [source](https://github.com/chendefine/dsh-web-search-aggregation) |
| `dsh-web-search-brave` | 0.2.3 | MIT | 1,287 | 2026-08-20 | [source](https://github.com/cnChenKai/dsh-web-search-brave) |
| `dsh-web-search-plugin` | 0.4.0 | MIT | 1,070 | 2026-09-02 | [source](https://github.com/X-C1811/dsh-web-search-plugin) |

The broader search also found thirdparty, DIY, SearXNG, keyless, and Tavily
bundles. These are not interchangeable with a deployment's explicitly selected
provider. The larger `pro` package's browser, cache, and extraction scope is not
needed for a narrow search replacement. Version 0.4.0 of `web-search-plugin`
declares 0.1.2-alpha.4 peers rather than the locked 0.1.1-rc.2 line.

## Evaluation

The two finalists have readable MIT tarballs and recent publications. Neither
has an install/postinstall script; aggregation declares prepare and
prepublishOnly build scripts, which were not run. No candidate was enabled.

**Brave 0.2.3:** no runtime dependencies; peers are
`@deepseek-ai/dsh-credentials ^0.0.1-rc.1`,
`@deepseek-ai/dsh-launch-environment ^0.0.1-rc.3`,
`@deepseek-ai/dsh-web ^0.0.1-rc.1`, and
`@deepseek-ai/schemastery ^3.18.1`. Its narrow `ctx.web` provider rejects
redirects and non-official endpoints by default and has no anonymous fallback.
It resolves credentials through DSH but also accepts literal configuration.
Upstream error detail is returned without secret redaction. Its old peer ranges
and disabled-only probe do not prove live compatibility with the locked host.

**Aggregation 0.1.10:** runtime dependency
`@deepseek-ai/schemastery >=3.18.1-rc.1 <4`; peers are
`@deepseek-ai/cordis >=4.0.1-rc.1 <5` and credentials/settings/web, each
`>=0.1.0-rc.6 <0.2.0 || >=0.1.1-rc.1 <1`. Its provider uses `ctx.web` and
rejects redirects. Its default queue enables nine services, including an
anonymous first choice. It rotates credential pools, logs upstream error
details, and exposes partially masked keys in its settings UI. These defaults
do not meet an explicit-provider, private-credential boundary without separate
downstream review and constrained configuration. It searches Tavily; that does
not establish Tavily URL extraction support.

Neither candidate is an authority engine. Both require credential/network
handling outside this repository's public composition ceiling. Registry
maintenance and download evidence are encouraging, but response quality,
credential isolation, and admitted invocation still need consumer tests.

## Probe results

Exact tarball SHA-256:

- Brave: `22f9ae99eff5c4381b1bea600f27ccdda531923b8308641ada4ab3f153d902be`.
- Aggregation: `961b697910053d5851641485d1237be80ca0bb5ea260d16aad4d527e271ebaa5`.

Both passed `scripts/dsh-plugin-probe.sh` with their exact versions and the
locked DSH 0.1.1-rc.2 launcher in separate throwaway homes. Install scripts
remained blocked. Both bundles self-register on add; after removing that
registration, each was absent without an insert row and mounted disabled with
the explicit row. No credentials or provider calls were used.

An initial probe using a profile-forcing operator launcher failed at CLI
argument parsing before installation. Repeating with the exact standalone
locked launcher passed; that first failure was not a candidate defect.

## Decision

**Reference** the narrow Brave provider's `ctx.web` integration and result
mapping, retaining the official Web service/tool vocabulary. No source is
copied and no public dependency, grant, or compatibility pin changes here.
Brave is the leading downstream candidate when that service is already
authorized; its actual host compatibility and error boundary remain adoption
gates. Do not enable aggregation's shipped fallback queue merely to hide a
provider failure. Evaluate URL extraction separately, including private-address
and redirect restrictions, rather than enabling unrestricted HTTP fetching.

Chat-model selection and search-provider selection are separate configuration
surfaces. End-to-end acceptance must prove the selected search service returns
usable sources and that extraction returns content, not just links. A working
chat turn or a disabled composition probe is not search acceptance.
