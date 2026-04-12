export default async function handler() {
  return new Response(
    JSON.stringify({
      error: 'PIN_SYSTEM_REMOVED',
      message: 'PIN system has been permanently disabled'
    }),
    { status: 410 }
  );
}
