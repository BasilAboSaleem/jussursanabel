const METADATA_SCHEMA_VERSION = '3';

function buildStripeDonationMetadata({
    donorId,
    isGuest,
    guestName,
    guestEmail,
    caseId,
    type,
    finalCaseAmount,
    totalAmount,
    institutionPercentage,
    gatewayPercentage,
    operationPercentage,
    institutionFee,
    gatewayFee,
    operationFee,
    isAnonymous,
    encouragementMessage,
    teamId
}) {
    const metadata = {
        schemaVersion: METADATA_SCHEMA_VERSION,
        caseId: String(caseId),
        type: String(type),
        amount: String(finalCaseAmount),
        totalAmount: String(totalAmount),
        institutionPct: String(institutionPercentage),
        gatewayPct: String(gatewayPercentage),
        operationPct: String(operationPercentage),
        institutionFee: String(institutionFee),
        gatewayFee: String(gatewayFee),
        operationFee: String(operationFee),
        isAnonymous: isAnonymous ? '1' : '0',
        isGuest: isGuest ? '1' : '0'
    };

    if (isGuest) {
        if (guestName) metadata.guestName = String(guestName).slice(0, 120);
        if (guestEmail) metadata.guestEmail = String(guestEmail).slice(0, 200);
    } else if (donorId) {
        metadata.donorId = String(donorId);
    }

    if (teamId) {
        metadata.teamId = String(teamId);
    }
    if (encouragementMessage) {
        metadata.encouragementMessage = String(encouragementMessage).slice(0, 500);
    }

    return metadata;
}

function parseStripeDonationMetadata(metadata = {}) {
    const schemaVersion = metadata.schemaVersion || '2';
    const isGuest = metadata.isGuest === '1' || metadata.isGuest === 'true';

    if (!metadata.caseId || !metadata.type || !metadata.amount) {
        return null;
    }

    if (schemaVersion === '3') {
        if (!isGuest && !metadata.donorId) {
            return null;
        }
    } else if (!metadata.donorId) {
        return null;
    }

    return {
        schemaVersion,
        donorId: metadata.donorId || null,
        isGuest,
        guestName: metadata.guestName || '',
        guestEmail: metadata.guestEmail || '',
        caseId: metadata.caseId,
        type: metadata.type,
        amount: Number(metadata.amount),
        totalAmount: Number(metadata.totalAmount || metadata.amount),
        institutionPercentage: Number(metadata.institutionPct || 0),
        gatewayPercentage: Number(metadata.gatewayPct || 0),
        operationPercentage: Number(metadata.operationPct || 0),
        institutionFee: Number(metadata.institutionFee || 0),
        gatewayFee: Number(metadata.gatewayFee || 0),
        operationFee: Number(metadata.operationFee || 0),
        isAnonymous: metadata.isAnonymous === '1' || metadata.isAnonymous === 'true',
        encouragementMessage: metadata.encouragementMessage || undefined,
        teamId: metadata.teamId || null
    };
}

module.exports = {
    METADATA_SCHEMA_VERSION,
    buildStripeDonationMetadata,
    parseStripeDonationMetadata
};
