/**
 * Generated Arenas (docs/plans/generated-arenas.md, ADR 0014): a Layout generated from a Kit and a seed,
 * assembled into an ordinary ArenaGeometry and judged with the real navmesh. Pure and deterministic.
 */
export { GREYBOX_KIT, PIECE_IDS, type Connector, type Kit, type Piece, type PieceId, type PieceSurface, type PieceWall, type Side, type Skirt } from './kit';
export { footprint, turnPoint, type Layout, type PlacedPiece } from './grid';
export { DEFAULT_GEN_PARAMS, generateLayout, type GenParams } from './layout';
export { assembleArena, SPAWNS_PER_TEAM } from './assemble';
export { DEADLY_RADIUS, DEFAULT_JUDGE_RULES, MIN_SPAWN_GAP, judgeArena, type Judgement, type JudgeRules, type JudgeStats } from './judge';
export { generateArena, generatedName, MAX_ATTEMPTS, type GeneratedArena } from './generate';
export { isArenaName, parseGeneratedName, withGeneratedArena } from './named';
export { GENERATOR_VERSION } from './version';
