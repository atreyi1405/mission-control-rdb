import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Google Sheets API endpoint for updating data
const GOOGLE_SHEETS_API = 'https://script.google.com/macros/s/AKfycbyLAUFNwYmN9b2aanC3dhlMrGt2CtZcpyxlwADSXkYqfY_EOnZmCOtoKkrfrw_7aVTn/exec';

/**
 * Sync a content version back to Google Sheets
 */
async function syncToGoogleSheets(versionId) {
    try {
        // 1. Get the full version data with all relations
        const { data: version, error } = await supabase
            .from('content_versions')
            .select(`
                *,
                classes (
                    class_name,
                    class_number,
                    modules (
                        module_name,
                        module_number,
                        programmes (
                            programme_name
                        )
                    )
                ),
                client_pathways (
                    cohort_name,
                    clients (
                        client_name
                    )
                )
            `)
            .eq('version_id', versionId)
            .single();

        if (error) throw error;

        // 2. Transform the data into Google Sheets format
        const sheetsData = {
            'Status': version.status || 'Open',
            'Client Name': version.client_pathways?.clients?.client_name || '',
            'Programme': version.classes?.modules?.programmes?.programme_name || '',
            'Cohort': version.client_pathways?.cohort_name || '',
            'Module No.': version.classes?.modules?.module_number || '',
            'Module Name': version.classes?.modules?.module_name || '',
            'Class No.': version.classes?.class_number || '',
            'Type': 'Slide Deck',  // Default value as per sheet
            'Class Name': version.classes?.class_name || '',
            'Version': version.version_number || '',
            'Delivery Method': 'Virtual',  // Default value as per sheet
            'Delivery Date': '',  // Can be updated later if needed
            'Notes': version.notes || '',
            'Link': version.drive_link || ''
        };

        // 3. Send to Google Sheets
        const response = await fetch(`${GOOGLE_SHEETS_API}?action=updateData`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(sheetsData)
        });

        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.message || 'Failed to update Google Sheets');
        }

        console.log('✅ Successfully synced to Google Sheets:', version.version_code);
        return true;

    } catch (error) {
        console.error('❌ Error syncing to Google Sheets:', error);
        return false;
    }
}

export async function setupSheetsSyncHooks() {
    // Listen for changes on content_versions table
    const changes = supabase
        .channel('content_versions_changes')
        .on(
            'postgres_changes',
            {
                event: '*', // Listen for all events (INSERT, UPDATE, DELETE)
                schema: 'public',
                table: 'content_versions'
            },
            async (payload) => {
                console.log('Change detected:', payload.eventType);
                
                if (payload.eventType === 'DELETE') {
                    // Handle deletion in Google Sheets
                    await fetch(`${GOOGLE_SHEETS_API}?action=deleteData`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            version_code: payload.old.version_code
                        })
                    });
                } else {
                    // For INSERT and UPDATE, sync the data
                    await syncToGoogleSheets(payload.new.version_id);
                }
            }
        )
        .subscribe();

    return changes;
}

// Export the sync function for manual use
export { syncToGoogleSheets };