/*
 * PAN structure rules, as issued by the Income Tax Department.
 *
 * AAAAA9999A — five letters, four digits, one check letter.
 *   position 4 encodes holder type (P individual, C company, H HUF, F firm,
 *     A AOP, T trust, B BOI, L local authority, J artificial juridical, G govt)
 *   position 5 is the first letter of the surname (or entity name)
 *
 * Validated structurally before any lookup: a malformed PAN is the partner's
 * error and should come back as a 400 they can act on, not a "not found" that
 * looks like the taxpayer does not exist.
 */
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const HOLDER_TYPES = {
  P: 'Individual',
  C: 'Company',
  H: 'Hindu Undivided Family',
  F: 'Firm / LLP',
  A: 'Association of Persons',
  T: 'Trust',
  B: 'Body of Individuals',
  L: 'Local Authority',
  J: 'Artificial Juridical Person',
  G: 'Government',
};

function isWellFormedPan(value) {
  return typeof value === 'string' && PAN_RE.test(value.toUpperCase());
}

function holderTypeOf(value) {
  return HOLDER_TYPES[value.toUpperCase()[3]] || null;
}

module.exports = { isWellFormedPan, holderTypeOf, HOLDER_TYPES };
