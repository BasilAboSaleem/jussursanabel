/**
 * Verifies guest donation metadata helpers and Transaction guest schema rules.
 *
 * Usage: npm run verify:guest-donation
 */
const {
    buildStripeDonationMetadata,
    parseStripeDonationMetadata,
    METADATA_SCHEMA_VERSION
} = require('../app/utils/stripeDonationMetadata');
const mongoose = require('mongoose');
const Transaction = require('../app/models/Transaction');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function testMetadataRoundTrip() {
    const guestMeta = buildStripeDonationMetadata({
        isGuest: true,
        caseId: new mongoose.Types.ObjectId(),
        type: 'direct',
        finalCaseAmount: 50,
        totalAmount: 52,
        institutionPercentage: 1,
        gatewayPercentage: 2,
        operationPercentage: 3,
        institutionFee: 0.5,
        gatewayFee: 1,
        operationFee: 1.5,
        isAnonymous: false,
        encouragementMessage: 'كلمة تحفيز',
        teamId: null
    });

    assert(guestMeta.schemaVersion === METADATA_SCHEMA_VERSION, 'guest metadata schema version mismatch');
    assert(guestMeta.isGuest === '1', 'guest flag missing in metadata');
    assert(!guestMeta.donorId, 'guest metadata should not include donorId');
    assert(!guestMeta.guestEmail, 'guest metadata should not require guestEmail upfront');

    const parsedGuest = parseStripeDonationMetadata(guestMeta);
    assert(parsedGuest && parsedGuest.isGuest, 'failed to parse guest metadata');

    const donorMeta = buildStripeDonationMetadata({
        donorId: new mongoose.Types.ObjectId(),
        isGuest: false,
        caseId: new mongoose.Types.ObjectId(),
        type: 'monthly',
        finalCaseAmount: 100,
        totalAmount: 103,
        institutionPercentage: 1,
        gatewayPercentage: 2,
        operationPercentage: 3,
        institutionFee: 1,
        gatewayFee: 2,
        operationFee: 3,
        isAnonymous: true,
        teamId: null
    });

    const parsedDonor = parseStripeDonationMetadata(donorMeta);
    assert(parsedDonor && !parsedDonor.isGuest, 'failed to parse registered donor metadata');
    assert(parsedDonor.donorId, 'donorId missing in parsed metadata');

    const legacyMeta = {
        schemaVersion: '2',
        donorId: String(new mongoose.Types.ObjectId()),
        caseId: String(new mongoose.Types.ObjectId()),
        type: 'direct',
        amount: '25',
        totalAmount: '26',
        isAnonymous: '0'
    };
    const parsedLegacy = parseStripeDonationMetadata(legacyMeta);
    assert(parsedLegacy && !parsedLegacy.isGuest, 'legacy v2 metadata should still parse');

    console.log('✓ Stripe donation metadata guest + legacy parsing');
}

async function testTransactionValidation() {
    const caseId = new mongoose.Types.ObjectId();
    const donorId = new mongoose.Types.ObjectId();

    const guestTx = new Transaction({
        isGuest: true,
        guestName: 'متبرع زائر',
        case: caseId,
        amount: 40,
        totalAmount: 42,
        type: 'direct',
        status: 'verified',
        paymentMethod: 'stripe_checkout'
    });

    await guestTx.validate();

    const guestTxWithEmail = new Transaction({
        isGuest: true,
        guestEmail: 'guest@example.com',
        case: caseId,
        amount: 40,
        totalAmount: 42,
        type: 'direct',
        status: 'verified',
        paymentMethod: 'stripe_checkout'
    });

    await guestTxWithEmail.validate();

    const registeredTx = new Transaction({
        donor: donorId,
        case: caseId,
        amount: 40,
        totalAmount: 42,
        type: 'direct',
        status: 'verified',
        paymentMethod: 'stripe_checkout'
    });

    await registeredTx.validate();

    const invalidRegistered = new Transaction({
        case: caseId,
        amount: 40,
        totalAmount: 42,
        type: 'direct'
    });

    let registeredValidationFailed = false;
    try {
        await invalidRegistered.validate();
    } catch (err) {
        registeredValidationFailed = true;
    }
    assert(registeredValidationFailed, 'registered transaction without donor should fail validation');

    console.log('✓ Transaction guest schema validation');
}

async function main() {
    testMetadataRoundTrip();
    await testTransactionValidation();
    console.log('All guest donation checks passed.');
}

main().catch((err) => {
    console.error('Guest donation verification failed:', err.message);
    process.exit(1);
});
