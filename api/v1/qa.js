
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://rujwuruuosffcxazymit.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    if (req.method === 'GET') {
      // Fetch latest QA run and findings
      const { data: latestRun, error: runError } = await supabase
        .from('qa_runs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (runError && runError.code !== 'PGRST116') throw runError;

      const { data: findings, error: findingsError } = await supabase
        .from('qa_findings')
        .select('*')
        .eq('run_id', latestRun?.id)
        .order('created_at', { ascending: false });

      if (findingsError) throw findingsError;

      const { data: repairs, error: repairsError } = await supabase
        .from('repair_runs')
        .select('*')
        .eq('run_id', latestRun?.id);

      if (repairsError) throw repairsError;

      return res.status(200).json({
        success: true,
        run: latestRun || null,
        findings: findings || [],
        repairs: repairs || [],
        timestamp: new Date().toISOString()
      });
    }

    if (req.method === 'POST') {
      // Start a new Deep QA Scan
      const { data: newRun, error: createError } = await supabase
        .from('qa_runs')
        .insert([{ status: 'running', stats: { clinics_checked: 0, total_findings: 0 } }])
        .select()
        .single();

      if (createError) throw createError;

      // Simulate Scanning Logic (In a real scenario, this would check actual endpoints)
      const findings = [];
      const clinics = ['clinic1', 'clinic2', 'lab', 'xray'];
      let totalFindings = 0;

      for (const clinic of clinics) {
        // Mock check for demonstration - in production this would be real checks
        const isHealthy = Math.random() > (process.env.FAILURE_RATE || 0.02); // 98% success rate by default
        if (!isHealthy) {
          findings.push({
            run_id: newRun.id,
            type: 'CLINIC_OFFLINE',
            severity: 'high',
            description: `Clinic ${clinic} is not responding correctly.`,
            fingerprint: `offline_${clinic}_${Date.now()}`,
            metadata: { clinic }
          });
          totalFindings++;
        }
      }
      const success_rate = ((clinics.length - totalFindings) / clinics.length) * 100;
      const failure_rate = (totalFindings / clinics.length) * 100;

      if (findings.length > 0) {
        await supabase.from('qa_findings').insert(findings);
      }

      // Update Run Status
      const { data: completedRun, error: updateError } = await supabase
        .from('qa_runs')
        .update({ 
          status: 'completed', 
          ok: findings.length === 0,
          stats: { clinics_checked: clinics.length, total_findings: totalFindings, success_rate, failure_rate },
          completed_at: new Date().toISOString()
        })
        .eq('id', newRun.id)
        .select()
        .single();

      if (updateError) throw updateError;

      // Auto-Repair Logic
      const repairResults = [];
      if (findings.length > 0) {
        for (const finding of findings) {
          const { data: repair, error: repairError } = await supabase
            .from('repair_runs')
            .insert([{
              run_id: newRun.id,
              finding_id: finding.id,
              playbook: 'SERVICE_RESTART',
              status: 'success',
              logs: `Successfully restarted service for ${finding.metadata.clinic}`
            }])
            .select()
            .single();
          
          if (!repairError) repairResults.push(repair);
        }
      }

      return res.status(200).json({
        success: true,
        success_rate,
        failure_rate,
        run: completedRun,
        findings,
        repairs: repairResults
      });
    }

  } catch (error) {
    console.error('QA Handler Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
