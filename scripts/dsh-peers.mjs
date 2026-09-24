// The DSH peer predicate the shipping test and the public-baseline gate both
// read: every `@deepseek-ai/dsh-*` peer range in a manifest. The certified line
// moves as one cut, so those ranges must reduce to exactly ONE — an install
// resolving two DSH generations at once is the failure both surfaces catch.
//
// Note `@deepseek-ai/dsh-` rather than the bare scope: the bare scope also
// holds `cordis`, which is not a DSH version line.
export function dshPeerRanges(manifest) {
  return new Set(
    Object.entries(manifest.peerDependencies ?? {})
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
      .map(([, range]) => range),
  )
}
