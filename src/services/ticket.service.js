// src/services/ticket.service.js
import mongoose from "mongoose";
import { Ticket } from "../models/ticket.model.js";
import { TicketMessage } from "../models/ticketMessage.model.js";
import { File } from "../models/file.model.js";
import { Notification } from "../models/notification.model.js";

export async function createTicketPackage({
  orgId,
  principalId,         // el usuario que está creando el ticket
  ticketData,          // title, description, categoryId, priorityId, etc.
  firstMessageBody,    // texto del primer mensaje
  uploadedFiles = [],  // array de archivos (viene de multer)
}) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1) Crear el ticket
    const ticket = await Ticket.create(
      [
        {
          orgId,
          title: ticketData.title,
          description: ticketData.description,
          categoryId: ticketData.categoryId,
          priorityId: ticketData.priorityId,
          statusId: ticketData.statusId,
          reporterId: principalId,
          assigneeType: ticketData.assigneeType,
          assigneeId: ticketData.assigneeId,
        },
      ],
      { session }
    ).then((docs) => docs[0]);

    // 2) Crear el primer mensaje ligado al ticket
    let message = null;
    if (firstMessageBody && firstMessageBody.trim() !== "") {
      message = await TicketMessage.create(
        [
          {
            orgId,
            ticketId: ticket._id,
            senderId: principalId,
            body: firstMessageBody,
          },
        ],
        { session }
      ).then((docs) => docs[0]);
    }

    // 3) Guardar archivos ligados al ticket (y opcional al mensaje)
    let fileDocs = [];
    if (uploadedFiles.length > 0) {
      const filesToInsert = uploadedFiles.map((f) => ({
        orgId,
        ticketId: ticket._id,
        messageId: message?._id || undefined,
        filename: f.filename,
        originalName: f.originalname,
        mimeType: f.mimetype,
        size: f.size,
        uploadedBy: principalId,
      }));

      fileDocs = await File.insertMany(filesToInsert, { session });
    }

    // 4) Crear notificación para el asignado (si hay)
    let notif = null;
    if (ticket.assigneeId) {
      notif = await Notification.create(
        [
          {
            orgId,
            type: "ticket_created",
            ticketId: ticket._id,
            recipientId: ticket.assigneeId,
            message: `Tienes un nuevo ticket: ${ticket.title}`,
          },
        ],
        { session }
      ).then((docs) => docs[0]);
    }

    // 5) Confirmar todo
    await session.commitTransaction();
    session.endSession();

    // Devuelves todo el “paquete”
    return {
      ticket,
      message,
      files: fileDocs,
      notification: notif,
    };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
}
