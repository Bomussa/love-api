import { createTicket } from '../../lib/queue.ts';

export async function handleCreateTicket(req: Request) {
  try {
    const body = await req.json();
    const { clinic_id, patient_id, exam_type } = body;
    
    if (!clinic_id) {
      return Response.json({ ok: false, error: { code: 'MISSING_CLINIC_ID', message: 'Clinic ID is required' } }, { status: 400 });
    }
    
    const ticket = await createTicket(clinic_id, patient_id || 'anonymous', exam_type);
    
    return Response.json({
      ok: true,
      data: {
        number: ticket.position,
        position: ticket.position,
        status: ticket.status
      }
    });
  } catch (err: any) {
    return Response.json({
      ok: false,
      error: {
        code: 'TICKET_CREATION_FAILED',
        message: err.message || 'Failed to create ticket'
      }
    }, { status: 500 });
  }
}
