/**
 * modules/medios/medios.controller.ts
 *
 * Flujo de subida de fotos/video de los usuarios:
 * 1. El cliente pide una URL firmada
 * 2. Sube el archivo DIRECTO a S3/R2 (nunca pasa por tu servidor Node)
 * 3. Avisa al backend que terminó -> se crea Publicación y/o Historia
 * 4. Si es video, se dispara un job de procesamiento en segundo plano
 *
 * Dependencias: npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
 */

import { s3, BUCKET } from "../../lib/s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "../../lib/prisma";
import { io } from "../../realtime/socket";
import { colaProcesamientoVideo } from "../../jobs/colas";
import crypto from "crypto";

// 1. Generar URL firmada para que el cliente suba directo a S3/R2
export async function generarUrlFirmada(req: any, res: any) {
  const { usuarioId } = req.auth; // viene del middleware de auth
  const { tipoArchivo, extension } = req.body; // "imagen" | "video", ej: "jpg", "mp4"

  const key = `subidas/${usuarioId}/${crypto.randomUUID()}.${extension}`;

  const comando = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: tipoArchivo === "video" ? `video/${extension}` : `image/${extension}`,
  });

  const urlFirmada = await getSignedUrl(s3, comando, { expiresIn: 300 }); // 5 min

  res.json({ urlFirmada, key });
}

// 2. El cliente llama esto cuando terminó de subir el archivo a S3
export async function confirmarSubida(req: any, res: any) {
  const { usuarioId } = req.auth;
  const { key, tipoArchivo, comoHistoria, comoPublicacion, texto } = req.body;

  const mediaUrl = `${process.env.CDN_URL}/${key}`;

  // Foto: ya está lista para mostrarse de inmediato
  if (tipoArchivo === "imagen") {
    const resultado = await guardarContenido({
      usuarioId, mediaUrl, texto, comoHistoria, comoPublicacion, estado: "listo",
    });
    return res.json(resultado);
  }

  // Video: se guarda en estado "procesando" y se dispara el job.
  // El usuario ve un placeholder hasta que el job avise que ya está listo.
  const resultado = await guardarContenido({
    usuarioId, mediaUrl, texto, comoHistoria, comoPublicacion, estado: "procesando",
  });

  await colaProcesamientoVideo.add("procesar-video", {
    key,
    publicacionId: resultado.publicacion?.id,
    historiaId: resultado.historia?.id,
  });

  res.json(resultado);
}

async function guardarContenido(opts: {
  usuarioId: string; mediaUrl: string; texto?: string;
  comoHistoria: boolean; comoPublicacion: boolean; estado: "listo" | "procesando";
}) {
  const out: any = {};

  if (opts.comoPublicacion) {
    out.publicacion = await prisma.publicacion.create({
      data: {
        tipo: "usuario", autor_id: opts.usuarioId, texto: opts.texto ?? "",
        media_url: opts.mediaUrl, estado_media: opts.estado,
      },
    });
    if (opts.estado === "listo") io.emit("publicacion:nueva", out.publicacion);
  }

  if (opts.comoHistoria) {
    out.historia = await prisma.historia.create({
      data: {
        tipo: "usuario", autor_id: opts.usuarioId, media_url: opts.mediaUrl,
        estado_media: opts.estado, expira_en: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    if (opts.estado === "listo") io.emit("historia:nueva", out.historia);
  }

  return out;
}

/**
 * jobs/procesar-video.worker.ts
 *
 * Corre en un worker aparte (no en el servidor web) porque procesar
 * video consume CPU. Usa ffmpeg para generar una miniatura y, si quieres
 * ahorrarte esto, puedes reemplazarlo por un servicio como Cloudflare
 * Stream o Mux que hace la transcodificación por ti.
 */
// import { Worker } from "bullmq";
//
// new Worker("procesar-video", async (job) => {
//   const { key, publicacionId, historiaId } = job.data;
//   // 1. Descargar el video de S3 a un archivo temporal
//   // 2. ffmpeg -i video.mp4 -ss 00:00:01 -vframes 1 miniatura.jpg
//   // 3. Subir la miniatura a S3
//   // 4. Marcar estado_media: "listo" en Publicacion/Historia
//   // 5. io.emit("publicacion:actualizada" / "historia:actualizada", ...)
// });
