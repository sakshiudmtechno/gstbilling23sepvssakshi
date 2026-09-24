import { listDocs, deleteDoc, getDoc, setDoc } from '../src/server/firestoreClient.ts';

async function main() {
  console.log('--- Clearing all dummy data from Firestore ---');
  const collections = ['invoices', 'clients', 'creditNotes', 'quotes', 'recurringInvoices', 'expenses'];

  for (const col of collections) {
    try {
      const res = await listDocs(col, { pageSize: 1000 });
      console.log(`Found ${res.docs.length} documents in ${col}`);
      for (const doc of res.docs) {
        await deleteDoc(col, doc.id);
        console.log(`Deleted ${col}/${doc.id}`);
      }
    } catch (err: any) {
      console.error(`Error clearing ${col}:`, err.message);
    }
  }

  // Reset invoice numbering sequence to 1 or starting number
  try {
    const invSettings = (await getDoc('settings', 'invoiceSettings')) || {};
    invSettings.nextSequence = 1;
    invSettings.startingNumber = 1;
    await setDoc('settings', 'invoiceSettings', invSettings, true);
    console.log('Reset invoiceSettings sequence to 1');
  } catch (err: any) {
    console.warn('Could not reset invoiceSettings:', err.message);
  }

  console.log('--- Dummy data deletion complete! Database is clean for manual user testing. ---');
}

main().catch(console.error);
