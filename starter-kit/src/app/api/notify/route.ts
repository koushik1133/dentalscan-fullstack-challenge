import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Notification API
 *
 * POST  /api/notify          — triggered when a scan finishes. Creates a
 *                              Notification row so the clinic can see it.
 * GET   /api/notify?userId=  — list notifications for a user (newest first).
 * PATCH /api/notify          — mark one or all notifications as read.
 */

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { scanId, status, userId = "clinic-default" } = body ?? {};

    if (!scanId || !status) {
      return NextResponse.json(
        { error: "Missing required fields: scanId, status" },
        { status: 400 }
      );
    }

    if (status === "completed") {
      const notification = await prisma.notification.create({
        data: {
          userId,
          title: "New scan uploaded",
          message: `Scan ${scanId} is ready for review. Join the Telehealth room to consult the patient.`,
        },
      });

      // Simulated side-effect: in production we'd push via Twilio/Telnyx here.
      console.log(
        `[notify] Created notification ${notification.id} for user ${userId} (scan ${scanId})`
      );

      return NextResponse.json({
        ok: true,
        notification,
        message: "Notification created",
      });
    }

    return NextResponse.json({ ok: true, message: `No action for status=${status}` });
  } catch (err) {
    console.error("Notification API Error:", err);
    return NextResponse.json(
      { error: "Internal Server Error", detail: String(err) },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId") ?? "clinic-default";

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const unreadCount = notifications.filter((n) => !n.read).length;

    return NextResponse.json({ notifications, unreadCount });
  } catch (err) {
    console.error("Notification GET Error:", err);
    return NextResponse.json(
      { error: "Internal Server Error", detail: String(err) },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id, userId, markAllRead } = body ?? {};

    if (markAllRead && userId) {
      const result = await prisma.notification.updateMany({
        where: { userId, read: false },
        data: { read: true },
      });
      return NextResponse.json({ ok: true, updated: result.count });
    }

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { read: true },
    });
    return NextResponse.json({ ok: true, notification: updated });
  } catch (err) {
    console.error("Notification PATCH Error:", err);
    return NextResponse.json(
      { error: "Internal Server Error", detail: String(err) },
      { status: 500 }
    );
  }
}
