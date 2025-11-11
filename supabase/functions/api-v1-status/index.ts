import { serve } from "https://deno.land/std/http/server.ts";

serve((req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response(null, {
            headers: {
                "access-control-allow-origin": "*",
                "access-control-allow-methods": "GET,POST,OPTIONS",
                "access-control-allow-headers": "content-type, authorization"
            }
        });
    }
    return new Response(JSON.stringify({
        ok: true,
        service: "love-api (supabase)",
        time: new Date().toISOString()
    }), {
        headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
            "access-control-allow-origin": "*"
        }
    });
});