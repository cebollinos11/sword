/**
 * Kits and Pieces (docs/plans/generated-arenas.md): the parts a Generated Arena is assembled from. The types and
 * their validation are Tuning Data (src/tuning/kit.ts); each Kit is a file, data/kits/<name>.json, built in Blender
 * by art/build_kit_<name>.py.
 */
import greyboxJson from '../../../data/kits/greybox.json';
import { parseKit, type Kit } from '../../tuning';

export { PIECE_IDS, type Connector, type Kit, type Piece, type PieceId, type PieceSurface, type PieceWall, type Side, type Skirt } from '../../tuning';

/** The grey placeholder Kit (data/kits/greybox.json): a 3 m grid, floors at 0, 3 and 6 m, 0.8 m crates. */
export const GREYBOX_KIT: Kit = parseKit(greyboxJson, 'data/kits/greybox.json');
