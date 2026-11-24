// Minimal GS1 EPCIS 2.0 (JSON-LD) event builder using CBV 2.0 bare-word vocabulary.
const crypto = require('crypto');

const CONTEXT = ['https://ref.gs1.org/standards/epcis/epcis-context.jsonld'];

function sgtinUri(gtin13, serial) {
  // urn:epc:id:sgtin:CompanyPrefix.ItemRef.Serial (company prefix length 7 for demo GTINs)
  const g = gtin13.padStart(14, '0');
  const indicator = g[0];
  const cp = g.slice(1, 8);
  const item = indicator + g.slice(8, 13);
  return `urn:epc:id:sgtin:${cp}.${item}.${serial}`;
}

function lgtinUri(gtin13, batchNo) {
  const g = gtin13.padStart(14, '0');
  return `urn:epc:class:lgtin:${g.slice(1, 8)}.${g[0]}${g.slice(8, 13)}.${batchNo}`;
}

function ssccUri(sscc) {
  return `urn:epc:id:sscc:${sscc.slice(1, 8)}.${sscc[0]}${sscc.slice(8, 17)}`;
}

function sglnUri(entityId) {
  return `urn:epc:id:sgln:8901234.${String(entityId).replace(/\D/g, '').padStart(5, '0')}.0`;
}

/**
 * Build an EPCIS 2.0 event.
 * @param {object} e { type, action, bizStep, disposition, epcList, quantityList, parentID, childEPCs, entityId, bizTransactionList, ilmd, extensions }
 */
function makeEvent(e) {
  const ev = {
    '@context': CONTEXT,
    type: e.type || 'ObjectEvent',
    eventID: 'ni:///sha-256;' + crypto.randomBytes(16).toString('hex') + '?ver=CBV2.0',
    eventTime: new Date().toISOString(),
    eventTimeZoneOffset: '+05:30',
    action: e.action || 'OBSERVE',
    bizStep: e.bizStep,
    disposition: e.disposition,
    readPoint: { id: sglnUri(e.entityId) },
    bizLocation: { id: sglnUri(e.entityId) },
  };
  if (e.epcList) ev.epcList = e.epcList;
  if (e.quantityList) ev.quantityList = e.quantityList;
  if (e.parentID) ev.parentID = e.parentID;
  if (e.childEPCs) ev.childEPCs = e.childEPCs;
  if (e.bizTransactionList) ev.bizTransactionList = e.bizTransactionList;
  if (e.sourceList) ev.sourceList = e.sourceList;
  if (e.destinationList) ev.destinationList = e.destinationList;
  if (e.ilmd) ev.ilmd = e.ilmd;
  if (e.sensorElementList) ev.sensorElementList = e.sensorElementList;
  return ev;
}

module.exports = { makeEvent, sgtinUri, lgtinUri, ssccUri, sglnUri };
