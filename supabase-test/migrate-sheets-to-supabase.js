// migrate-sheets-to-supabase.js
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Your Google Sheets API URL
const GOOGLE_SHEETS_API = 'https://script.google.com/macros/s/AKfycbyLAUFNwYmN9b2aanC3dhlMrGt2CtZcpyxlwADSXkYqfY_EOnZmCOtoKkrfrw_7aVTn/exec';

// Helper function to extract number from string like "Class 1" -> 1
function extractNumber(str) {
  if (!str) return null;
  const match = str.toString().match(/\d+/);
  return match ? parseInt(match[0]) : null;
}

async function fetchGoogleSheetsData() {
  console.log('📥 Fetching data from Google Sheets...');
  const response = await fetch(`${GOOGLE_SHEETS_API}?action=getAllData`);
  const result = await response.json();
  
  if (!result.success) {
    throw new Error('Failed to fetch Google Sheets data');
  }
  
  console.log(`✅ Fetched ${result.data.length} rows from Google Sheets`);
  return result.data;
}

async function extractUniqueClients(sheetsData) {
  console.log('\n🏢 Extracting unique clients...');
  const uniqueClients = [...new Set(sheetsData.map(row => row['Client Name']).filter(Boolean))];
  
  const clientMap = new Map();
  
  for (const clientName of uniqueClients) {
    const { data: existing } = await supabase
      .from('clients')
      .select('client_id, client_name')
      .eq('client_name', clientName)
      .single();
    
    if (existing) {
      console.log(`  ↪ Client "${clientName}" already exists (ID: ${existing.client_id})`);
      clientMap.set(clientName, existing.client_id);
    } else {
      const { data: inserted, error } = await supabase
        .from('clients')
        .insert([{ client_name: clientName }])
        .select()
        .single();
      
      if (error) {
        console.error(`  ❌ Error inserting client "${clientName}":`, error);
      } else {
        console.log(`  ✅ Inserted client "${clientName}" (ID: ${inserted.client_id})`);
        clientMap.set(clientName, inserted.client_id);
      }
    }
  }
  
  return clientMap;
}

async function extractUniqueProgrammes(sheetsData) {
  console.log('\n📚 Extracting unique programmes...');
  const uniqueProgrammes = [...new Set(sheetsData.map(row => row['Programme']).filter(Boolean))];
  
  const programmeMap = new Map();
  
  for (const programmeName of uniqueProgrammes) {
    const { data: existing } = await supabase
      .from('programmes')
      .select('programme_id, programme_name')
      .eq('programme_name', programmeName)
      .single();
    
    if (existing) {
      console.log(`  ↪ Programme "${programmeName}" already exists (ID: ${existing.programme_id})`);
      programmeMap.set(programmeName, existing.programme_id);
    } else {
      const { data: inserted, error } = await supabase
        .from('programmes')
        .insert([{ 
          programme_name: programmeName,
          programme_type: 'Standard'
        }])
        .select()
        .single();
      
      if (error) {
        console.error(`  ❌ Error inserting programme "${programmeName}":`, error);
      } else {
        console.log(`  ✅ Inserted programme "${programmeName}" (ID: ${inserted.programme_id})`);
        programmeMap.set(programmeName, inserted.programme_id);
      }
    }
  }
  
  return programmeMap;
}

async function extractModulesAndClasses(sheetsData, programmeMap) {
  console.log('\n📖 Extracting modules and classes...');
  
  const moduleMap = new Map();
  const classMap = new Map();
  
  // Group by Programme -> Module
  const programmeModules = new Map();
  
  for (const row of sheetsData) {
    const programmeName = row['Programme'];
    const moduleName = row['Module Name'];
    const moduleNo = row['Module No.'];
    const className = row['Class Name'];
    const classNo = row['Class No.'];
    const type = row['Type'] || 'Slide Deck';
    
    if (!programmeName || !moduleName) continue;
    
    const key = `${programmeName}::${moduleName}`;
    
    if (!programmeModules.has(key)) {
      programmeModules.set(key, {
        programmeName,
        moduleName,
        moduleNo,
        classes: []
      });
    }
    
    if (className && classNo) {
      programmeModules.get(key).classes.push({
        className,
        classNo,
        type
      });
    }
  }
  
  // Insert modules and classes
  for (const [key, moduleData] of programmeModules.entries()) {
    const programmeId = programmeMap.get(moduleData.programmeName);
    
    if (!programmeId) {
      console.log(`  ⚠️ Skipping module "${moduleData.moduleName}" - programme not found`);
      continue;
    }
    
    // Extract module number
    const moduleNumber = extractNumber(moduleData.moduleNo);
    
    // Check if module exists
    const { data: existingModule } = await supabase
      .from('modules')
      .select('module_id')
      .eq('programme_id', programmeId)
      .eq('module_name', moduleData.moduleName)
      .maybeSingle();
    
    let moduleId;
    
    if (existingModule) {
      moduleId = existingModule.module_id;
      console.log(`  ↪ Module "${moduleData.moduleName}" already exists (ID: ${moduleId})`);
    } else {
      const { data: insertedModule, error } = await supabase
        .from('modules')
        .insert([{
          programme_id: programmeId,
          module_number: moduleNumber,
          module_name: moduleData.moduleName
        }])
        .select()
        .single();
      
      if (error) {
        console.error(`  ❌ Error inserting module "${moduleData.moduleName}":`, error.message);
        continue;
      }
      
      moduleId = insertedModule.module_id;
      console.log(`  ✅ Inserted module "${moduleData.moduleName}" (ID: ${moduleId})`);
    }
    
    moduleMap.set(key, moduleId);
    
    // Get unique classes
    const uniqueClasses = [...new Map(
      moduleData.classes.map(c => [`${c.classNo}::${c.className}`, c])
    ).values()];
    
    // Insert classes
    for (const classData of uniqueClasses) {
      // Extract class number
      const classNumber = extractNumber(classData.classNo);
      
      // Check if class exists
      const { data: existingClass } = await supabase
        .from('classes')
        .select('class_id')
        .eq('module_id', moduleId)
        .eq('class_name', classData.className)
        .maybeSingle();
      
      if (existingClass) {
        classMap.set(`${key}::${classData.className}`, existingClass.class_id);
      } else {
        const { data: insertedClass, error } = await supabase
          .from('classes')
          .insert([{
            module_id: moduleId,
            class_number: classNumber,
            class_name: classData.className,
            material_type: classData.type
          }])
          .select()
          .single();
        
        if (error) {
          console.error(`Error inserting class "${classData.className}":`, error.message);
        } else {
          classMap.set(`${key}::${classData.className}`, insertedClass.class_id);
          console.log(`Inserted class "${classData.className}"`);
        }
      }
    }
  }
  
  return { moduleMap, classMap };
}

async function createClientPathways(sheetsData, clientMap, programmeMap) {
  console.log('\n Creating client pathways...');
  
  const pathwayMap = new Map();
  const uniquePathways = new Map();
  
  // Extract unique client-programme-cohort combinations
  for (const row of sheetsData) {
    const clientName = row['Client Name'];
    const programmeName = row['Programme'];
    const cohort = row['Cohort'] || 'Default';
    
    if (!clientName || !programmeName) continue;
    
    const key = `${clientName}::${programmeName}::${cohort}`;
    uniquePathways.set(key, { clientName, programmeName, cohort });
  }
  
  for (const [key, pathway] of uniquePathways.entries()) {
    const clientId = clientMap.get(pathway.clientName);
    const programmeId = programmeMap.get(pathway.programmeName);
    
    if (!clientId || !programmeId) {
      console.log(`  ⚠️ Skipping pathway "${key}" - missing client or programme`);
      continue;
    }
    
    // Check if pathway exists
    const { data: existing } = await supabase
      .from('client_pathways')
      .select('pathway_id')
      .eq('client_id', clientId)
      .eq('programme_id', programmeId)
      .eq('cohort_name', pathway.cohort)
      .maybeSingle();
    
    if (existing) {
      pathwayMap.set(key, existing.pathway_id);
      console.log(`  ↪ Pathway "${key}" already exists`);
    } else {
      const { data: inserted, error } = await supabase
        .from('client_pathways')
        .insert([{
          client_id: clientId,
          programme_id: programmeId,
          cohort_name: pathway.cohort,
          status: 'Active'
        }])
        .select()
        .single();
      
      if (error) {
        console.error(`Error creating pathway "${key}":`, error.message);
      } else {
        pathwayMap.set(key, inserted.pathway_id);
        console.log(`Created pathway "${key}" (ID: ${inserted.pathway_id})`);
      }
    }
  }
  
  return pathwayMap;
}

async function createBasicVersionRecords(sheetsData, clientMap, programmeMap, moduleMap, classMap, pathwayMap) {
  console.log('\n Creating basic content records (no version control yet)...');
  
  let createdCount = 0;
  let skippedCount = 0;
  
  for (const row of sheetsData) {
    const clientName = row['Client Name'];
    const programmeName = row['Programme'];
    const cohort = row['Cohort'] || 'Default';
    const moduleName = row['Module Name'];
    const className = row['Class Name'];
    const version = row['Version'];
    const status = row['Status'];
    const link = row['Link'];
    const notes = row['Notes'];
    const deliveryMethod = row['Delivery Method'];
    
    if (!className || !moduleName) {
      skippedCount++;
      continue;
    }
    
    const pathwayKey = `${clientName}::${programmeName}::${cohort}`;
    const moduleKey = `${programmeName}::${moduleName}`;
    const classKey = `${moduleKey}::${className}`;
    
    const pathwayId = pathwayMap.get(pathwayKey);
    const classId = classMap.get(classKey);
    
    if (!pathwayId || !classId) {
      skippedCount++;
      continue;
    }
    
    // Generate a simple version code based on row data
    const versionCode = `${clientName.substring(0, 3).toUpperCase()}-${moduleName.substring(0, 3).toUpperCase()}-${className.substring(0, 3).toUpperCase()}-${version || 'v1'}`.replace(/\s/g, '');
    
    // Check if this exact combination already exists
    const { data: existing } = await supabase
      .from('content_versions')
      .select('version_id')
      .eq('class_id', classId)
      .eq('pathway_id', pathwayId)
      .eq('version_number', version || 'v1.0')
      .maybeSingle();
    
    if (existing) {
      skippedCount++;
      continue;
    }
    
    // Insert basic version record
    const { data: inserted, error } = await supabase
      .from('content_versions')
      .insert([{
        class_id: classId,
        pathway_id: pathwayId,
        version_code: versionCode,
        version_number: version || 'v1.0',
        status: status || 'Open',
        drive_link: link,
        delivery_method: deliveryMethod || 'Virtual',
        notes: notes
      }])
      .select()
      .single();
    
    if (error) {
      console.error(`  ❌ Error creating record for "${className}":`, error.message);
      skippedCount++;
    } else {
      createdCount++;
      if (createdCount % 10 === 0) {
        console.log(`  ✅ Created ${createdCount} records...`);
      }
    }
  }
  
  console.log(`\n Migration complete: ${createdCount} records created, ${skippedCount} skipped`);
}

async function main() {
  try {
    console.log('🚀 Starting migration from Google Sheets to Supabase...\n');
    
    const sheetsData = await fetchGoogleSheetsData();
    const clientMap = await extractUniqueClients(sheetsData);
    const programmeMap = await extractUniqueProgrammes(sheetsData);
    const { moduleMap, classMap } = await extractModulesAndClasses(sheetsData, programmeMap);
    const pathwayMap = await createClientPathways(sheetsData, clientMap, programmeMap);
    await createBasicVersionRecords(sheetsData, clientMap, programmeMap, moduleMap, classMap, pathwayMap);
    
    console.log('\n✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

main();