import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Messaging API
 *
 * GET  /api/messaging?threadId=xxx           — fetch messages for a thread
 * GET  /api/messaging?patientId=xxx          — find-or-create a thread for patient, return messages
 * POST /api/messaging  { threadId?, patientId?, content, sender }
 *   Persists a message. If no threadId is supplied but patientId is, creates
 *   (or reuses) the patient's thread.
 */

async function getOrCreateThreadForPatient(patientId: string) {
  const existing = await prisma.thread.findFirst({
    where: { patientId },
    orderBy: { updatedAt: "desc" },
  });
  if (existing) return existing;
  return prisma.thread.create({ data: { patientId } });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const threadId = searchParams.get("threadId");
    const patientId = searchParams.get("patientId");

    if (!threadId && !patientId) {
      return NextResponse.json(
        { error: "Provide either threadId or patientId" },
        { status: 400 }
      );
    }

    let resolvedThreadId = threadId;
    if (!resolvedThreadId && patientId) {
      const thread = await getOrCreateThreadForPatient(patientId);
      resolvedThreadId = thread.id;
    }

    const messages = await prisma.message.findMany({
      where: { threadId: resolvedThreadId! },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ threadId: resolvedThreadId, messages });
  } catch (err) {
    console.error("Messaging GET Error:", err);
    return NextResponse.json(
      { error: "Internal Server Error", detail: String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { threadId, patientId, content, sender } = body ?? {};

    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "Message content is required" }, { status: 400 });
    }
    if (!sender || !["patient", "dentist"].includes(sender)) {
      return NextResponse.json(
        { error: "Sender must be 'patient' or 'dentist'" },
        { status: 400 }
      );
    }

    // Resolve thread: use provided id, or derive from patientId
    let resolvedThreadId: string | null = threadId ?? null;
    if (!resolvedThreadId) {
      if (!patientId) {
        return NextResponse.json(
          { error: "Provide either threadId or patientId" },
          { status: 400 }
        );
      }
      const thread = await getOrCreateThreadForPatient(patientId);
      resolvedThreadId = thread.id;
    } else {
      // Validate the thread exists
      const thread = await prisma.thread.findUnique({ where: { id: resolvedThreadId } });
      if (!thread) {
        return NextResponse.json({ error: "Thread not found" }, { status: 404 });
      }
    }

    const message = await prisma.message.create({
      data: {
        threadId: resolvedThreadId,
        content: content.trim(),
        sender,
      },
    });

    // Touch the thread's updatedAt
    await prisma.thread.update({
      where: { id: resolvedThreadId },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({ ok: true, threadId: resolvedThreadId, message });
  } catch (err) {
    console.error("Messaging POST Error:", err);
    return NextResponse.json(
      { error: "Internal Server Error", detail: String(err) },
      { status: 500 }
    );
  }
}
