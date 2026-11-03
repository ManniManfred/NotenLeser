/**
 * SMuFL code points and bounding boxes of the bundled Leland music font (from leland_metadata.json).
 * Boxes are in staff spaces with y pointing down, relative to the glyph origin at a font size of 4 staff spaces.
 * Glyphs are single-character strings.
 */
const BY_NAME = new Map()
const BOXES = new Map()

function def(name, codePoint, swX, swY, neX, neY) {
	const c = String.fromCharCode(codePoint)
	BY_NAME.set(name, c)
	BOXES.set(c, [swX, -neY, neX, -swY])
	return c
}

export const G = {
	G_CLEF: def('gClef', 0xE050, 0, -2.666, 2.56, 4.449),
	G_CLEF_8VB: def('gClef8vb', 0xE052, 0, -3.59, 2.56, 4.45),
	G_CLEF_8VA: def('gClef8va', 0xE053, 0, -2.664, 2.56, 5.35),
	C_CLEF: def('cClef', 0xE05C, 0, -1.92, 2.508, 1.928),
	F_CLEF: def('fClef', 0xE062, 0.001, -2.468, 2.656, 1.004),
	F_CLEF_8VB: def('fClef8vb', 0xE064, 0.001, -2.968, 2.656, 1.004),
	PERCUSSION_CLEF: def('unpitchedPercussionClef1', 0xE069, 0, -1.008, 1.408, 1.008),
	NOTEHEAD_DOUBLE_WHOLE: def('noteheadDoubleWhole', 0xE0A0, 0, -0.712, 2.152, 0.716),
	NOTEHEAD_WHOLE: def('noteheadWhole', 0xE0A2, 0, -0.536, 1.492, 0.544),
	NOTEHEAD_HALF: def('noteheadHalf', 0xE0A3, 0, -0.532, 1.3, 0.528),
	NOTEHEAD_BLACK: def('noteheadBlack', 0xE0A4, 0, -0.532, 1.3, 0.528),
	NOTEHEAD_X: def('noteheadXBlack', 0xE0A9, 0, -0.528, 1.3, 0.528),
	FLAGS_UP: [
		def('flag8thUp', 0xE240, 0.001, -3.268, 1.157, 0.048), def('flag16thUp', 0xE242, 0, -3.281, 1.116, 0.049),
		def('flag32ndUp', 0xE244, 0, -3.285, 1.117, 0.745), def('flag64thUp', 0xE246, 0, -3.287, 1.117, 1.493)],
	FLAGS_DOWN: [
		def('flag8thDown', 0xE241, 0, -0.048, 1.235, 3.268), def('flag16thDown', 0xE243, 0, -0.104, 1.235, 3.213),
		def('flag32ndDown', 0xE245, 0, -0.863, 1.235, 3.214), def('flag64thDown', 0xE247, 0, -1.61, 1.235, 3.214)],
	FLAT: def('accidentalFlat', 0xE260, 0, -0.704, 0.812, 1.812),
	NATURAL: def('accidentalNatural', 0xE261, 0, -1.292, 0.684, 1.3),
	SHARP: def('accidentalSharp', 0xE262, 0, -1.332, 0.976, 1.336),
	DOUBLE_SHARP: def('accidentalDoubleSharp', 0xE263, 0, -0.548, 1.1, 0.552),
	DOUBLE_FLAT: def('accidentalDoubleFlat', 0xE264, 0, -0.704, 1.484, 1.812),
	REST_DOUBLE_WHOLE: def('restDoubleWhole', 0xE4E2, 0.001, -0.044, 0.501, 1.048),
	REST_WHOLE: def('restWhole', 0xE4E3, 0, -0.524, 1.3, 0.02),
	REST_HALF: def('restHalf', 0xE4E4, 0, -0.016, 1.3, 0.528),
	REST_QUARTER: def('restQuarter', 0xE4E5, 0, -1.325, 0.94, 1.605),
	REST_8TH: def('rest8th', 0xE4E6, 0, -1.022, 1.104, 0.814),
	REST_16TH: def('rest16th', 0xE4E7, 0.004, -2.029, 1.376, 0.815),
	REST_32ND: def('rest32nd', 0xE4E8, 0, -2.029, 1.563, 1.839),
	REST_64TH: def('rest64th', 0xE4E9, -0.002, -3.032, 1.69, 1.855),
	TIME_DIGITS: [
		def('timeSig0', 0xE080, 0.06, -1.016, 1.556, 1.02), def('timeSig1', 0xE081, 0.06, -0.972, 1.344, 0.98),
		def('timeSig2', 0xE082, 0.06, -0.972, 1.508, 0.98), def('timeSig3', 0xE083, 0.06, -0.976, 1.457, 0.976),
		def('timeSig4', 0xE084, 0.055, -0.992, 1.768, 0.996), def('timeSig5', 0xE085, 0.06, -0.976, 1.448, 0.984),
		def('timeSig6', 0xE086, 0.06, -0.976, 1.548, 0.98), def('timeSig7', 0xE087, 0.058, -1.0, 1.462, 1.004),
		def('timeSig8', 0xE088, 0.06, -0.992, 1.572, 0.984), def('timeSig9', 0xE089, 0.06, -0.976, 1.548, 0.98)],
	TIME_COMMON: def('timeSigCommon', 0xE08A, 0, -1.024, 1.852, 1.032),
	TIME_CUT: def('timeSigCutCommon', 0xE08B, 0, -1.504, 1.852, 1.552),
	DOT: def('augmentationDot', 0xE1E7, 0, -0.2, 0.4, 0.2),
	DYNAMIC_P: def('dynamicPiano', 0xE520, -0.38, -0.652, 1.268, 1.052),
	DYNAMIC_M: def('dynamicMezzo', 0xE521, -0.028, -0.008, 1.496, 1.004),
	DYNAMIC_F: def('dynamicForte', 0xE522, -0.548, -0.772, 1.336, 1.684),
	DYNAMIC_R: def('dynamicRinforzando', 0xE523, -0.048, 0, 0.92, 1.016),
	DYNAMIC_S: def('dynamicSforzando', 0xE524, 0, -0.02, 0.832, 1.052),
	DYNAMIC_Z: def('dynamicZ', 0xE525, -0.168, -0.004, 0.956, 1.032),
	DYNAMIC_N: def('dynamicNiente', 0xE526, -0.048, -0.004, 1.02, 1.016),
	FERMATA_ABOVE: def('fermataAbove', 0xE4C0, 0, 0, 2.488, 1.472),
	FERMATA_BELOW: def('fermataBelow', 0xE4C1, 0, -1.472, 2.488, 0),
	SEGNO: def('segno', 0xE047, 0, 0, 2.616, 3.476),
	CODA: def('coda', 0xE048, 0, -0.452, 2.98, 2.94),
	REPEAT_DOT: def('repeatDot', 0xE044, 0, -0.212, 0.416, 0.212),
	BREATH: def('breathMarkComma', 0xE4CE, 0, 0.001, 0.764, 1.285),
	BRACE: def('brace', 0xE000, -0.002, 0.019, 0.248, 3.98),
}

def('articAccentAbove', 0xE4A0, 0, 0, 1.444, 0.94); def('articAccentBelow', 0xE4A1, 0, -0.94, 1.444, 0)
def('articStaccatoAbove', 0xE4A2, 0, 0, 0.312, 0.312); def('articStaccatoBelow', 0xE4A3, 0, -0.312, 0.312, 0)
def('articTenutoAbove', 0xE4A4, 0, 0, 1.264, 0.184); def('articTenutoBelow', 0xE4A5, 0, -0.184, 1.264, 0)
def('articStaccatissimoAbove', 0xE4A6, 0, 0, 0.508, 0.992); def('articStaccatissimoBelow', 0xE4A7, 0, -0.992, 0.507, 0)
def('articMarcatoAbove', 0xE4AC, 0.004, 0, 1.184, 1.012); def('articMarcatoBelow', 0xE4AD, 0, -1.012, 1.18, 0)
def('ornamentTrill', 0xE566, -0.048, 0, 1.532, 1.532); def('ornamentTurn', 0xE567, 0, 0, 1.824, 0.928)
def('ornamentShortTrill', 0xE56C, 0, 0, 1.892, 0.992); def('ornamentMordent', 0xE56D, 0, -0.308, 1.892, 1.264)
def('brassMuteClosed', 0xE5E5, 0, 0, 1.248, 1.248); def('brassMuteOpen', 0xE5E7, 0, 0, 1.12, 1.12)
def('metNoteWhole', 0xE1D2, -0.001, -0.688, 1.899, 0.688); def('metNoteHalfUp', 0xE1D3, 0, -0.686, 1.7, 3.454)
def('metNoteQuarterUp', 0xE1D5, -0.002, -0.69, 1.698, 3.45); def('metNote8thUp', 0xE1D7, 0, -0.689, 2.844, 3.603)
def('metAugmentationDot', 0xE1E7, 0, -0.2, 0.4, 0.2)

/** Glyph for a SMuFL name, or '' when unknown. */
export function byName(name) { return BY_NAME.get(name) || '' }

/** Glyph box [left, top, right, bottom] at font size 4 staff spaces, or null for unknown characters. */
export function box(c) { return BOXES.get(c) || null }

export function width(c) { const b = BOXES.get(c); return b ? b[2] : 1 }

export function isMusic(c) { const code = c.charCodeAt(0); return code >= 0xE000 && code <= 0xF8FF }

/** Maps a symbol name used inside MuseScore texts to a character for text runs. */
export function symbolForName(name) {
	if (name === 'space') return ' '
	if (name === 'metNote16thUp') return String.fromCharCode(0xE1D9)
	return byName(name)
}

const DYNAMIC_LETTERS = { p: G.DYNAMIC_P, m: G.DYNAMIC_M, f: G.DYNAMIC_F, r: G.DYNAMIC_R, s: G.DYNAMIC_S, z: G.DYNAMIC_Z, n: G.DYNAMIC_N }

export function dynamicLetter(letter) { return DYNAMIC_LETTERS[letter] || '' }
