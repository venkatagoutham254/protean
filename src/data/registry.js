/*
 * Identity registry backing the sandbox environment.
 *
 * Every record here is fabricated. Aadhaar numbers are drawn from the 9999xxx
 * range and carry correct Verhoeff check digits, so they exercise the same
 * validation path as production without colliding with any number UIDAI has
 * issued. PANs follow the Income Tax structure with surnames that match the
 * holder name, because a partner testing name-match logic needs the fifth
 * character to line up the way it does in production.
 *
 * Records are chosen to cover the cases partners actually hit: a clean match, a
 * name that differs by initials, a locked record, and a number that is
 * structurally valid but not enrolled.
 */
const { withCheckDigit } = require('../lib/verhoeff');

const A = (body) => withCheckDigit(body);

const RESIDENTS = [
  {
    aadhaar: A('99900010000'),
    name: 'Ananya Krishnan',
    dob: '1991-04-17',
    gender: 'F',
    mobileLast4: '4417',
    email: 'a****n@example.in',
    address: {
      careOf: 'D/O Krishnan R',
      house: '14, Brindavan Layout',
      street: 'Sarjapur Road',
      locality: 'Bellandur',
      district: 'Bengaluru Urban',
      state: 'Karnataka',
      pincode: '560103',
      country: 'India',
    },
    pan: 'AKRPK4417J',
    status: 'ACTIVE',
  },
  {
    aadhaar: A('99900020000'),
    name: 'R. Venkatesh',
    dob: '1985-11-02',
    gender: 'M',
    mobileLast4: '9021',
    email: 'v****h@example.in',
    address: {
      careOf: 'S/O Ramachandran V',
      house: '7B, Kaveri Apartments',
      street: 'Anna Salai',
      locality: 'Teynampet',
      district: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600018',
      country: 'India',
    },
    pan: 'AVNPV9021C',
    status: 'ACTIVE',
  },
  {
    aadhaar: A('99900030000'),
    name: 'Meera Sanjay Deshpande',
    dob: '1996-07-29',
    gender: 'F',
    mobileLast4: '3388',
    email: 'm****e@example.in',
    address: {
      careOf: 'W/O Sanjay Deshpande',
      house: 'Flat 902, Orchid Towers',
      street: 'Baner Road',
      locality: 'Baner',
      district: 'Pune',
      state: 'Maharashtra',
      pincode: '411045',
      country: 'India',
    },
    pan: 'BMDPD3388K',
    status: 'ACTIVE',
  },
  {
    // Biometric/OTP locked by the resident through the UIDAI portal. Exists,
    // but authentication must be refused — a distinct outcome from "not found",
    // and one partners must handle differently in their onboarding flow.
    aadhaar: A('99900040000'),
    name: 'Imran Qureshi',
    dob: '1979-01-23',
    gender: 'M',
    mobileLast4: '7712',
    email: 'i****i@example.in',
    address: {
      careOf: 'S/O Abdul Qureshi',
      house: '221, Nizam Colony',
      street: 'Tolichowki',
      locality: 'Hyderabad',
      district: 'Hyderabad',
      state: 'Telangana',
      pincode: '500008',
      country: 'India',
    },
    pan: 'CIQPQ7712M',
    status: 'AUTH_LOCKED',
  },
];

const PANS = {
  AKRPK4417J: { name: 'Ananya Krishnan', status: 'VALID', aadhaarSeeded: true, lastUpdated: '2026-03-11' },
  AVNPV9021C: { name: 'R. Venkatesh', status: 'VALID', aadhaarSeeded: true, lastUpdated: '2025-12-02' },
  BMDPD3388K: { name: 'Meera Sanjay Deshpande', status: 'VALID', aadhaarSeeded: false, lastUpdated: '2026-06-30' },
  CIQPQ7712M: { name: 'Imran Qureshi', status: 'VALID', aadhaarSeeded: true, lastUpdated: '2024-09-14' },
  // Surrendered PANs still resolve — the partner needs the status, not a 404.
  DXXPS1102L: { name: 'Suhas Pillai', status: 'SURRENDERED', aadhaarSeeded: false, lastUpdated: '2023-02-08' },
};

const DOCUMENTS = {
  [A('99900010000')]: [
    { docType: 'AADHAAR', issuer: 'UIDAI', issuedOn: '2013-08-04', docId: 'uidai-eaadhaar-0001', sizeBytes: 184320, mime: 'application/pdf' },
    { docType: 'PAN', issuer: 'Income Tax Department', issuedOn: '2016-01-19', docId: 'itd-pan-0001', sizeBytes: 96010, mime: 'application/pdf' },
    { docType: 'DRIVING_LICENCE', issuer: 'Transport Department, Karnataka', issuedOn: '2019-05-22', docId: 'ka-dl-0001', sizeBytes: 210448, mime: 'application/pdf' },
  ],
  [A('99900020000')]: [
    { docType: 'AADHAAR', issuer: 'UIDAI', issuedOn: '2012-11-30', docId: 'uidai-eaadhaar-0002', sizeBytes: 179200, mime: 'application/pdf' },
    { docType: 'VEHICLE_RC', issuer: 'Transport Department, Tamil Nadu', issuedOn: '2021-02-15', docId: 'tn-rc-0002', sizeBytes: 143872, mime: 'application/pdf' },
  ],
  [A('99900030000')]: [
    { docType: 'AADHAAR', issuer: 'UIDAI', issuedOn: '2015-06-11', docId: 'uidai-eaadhaar-0003', sizeBytes: 181248, mime: 'application/pdf' },
    { docType: 'CLASS_X_MARKSHEET', issuer: 'CBSE', issuedOn: '2012-05-28', docId: 'cbse-x-0003', sizeBytes: 88064, mime: 'application/pdf' },
  ],
};

const byAadhaar = new Map(RESIDENTS.map((r) => [r.aadhaar, r]));

module.exports = { RESIDENTS, PANS, DOCUMENTS, byAadhaar };
