/**
 * jobs/feed-noticias.ts
 *
 * Job que corre cada N minutos, lee varias fuentes RSS de medios
 * venezolanos, filtra lo que realmente sea sobre Venezuela, deduplica
 * y guarda como publicaciones tipo "noticia_externa".
 *
 * Dependencias: npm i rss-parser
 */

import Parser from "rss-parser";
import { prisma } from "../lib/prisma";
import { io } from "../realtime/socket";
import crypto from "crypto";

const parser = new Parser();

// 1. Fuentes RSS venezolanas. Prioriza medios con cobertura fuerte
//    en investigación, DD.HH. y fiscalización del poder — no todos
//    los medios generalistas cubren estos temas a fondo.
const FUENTES = [
  { nombre: "El Nacional", url: "https://www.elnacional.com/feed/" },
  { nombre: "Efecto Cocuyo", url: "https://efectococuyo.com/feed/" },
  { nombre: "Tal Cual", url: "https://talcualdigital.com/feed/" },
  { nombre: "Runrun.es", url: "https://runrun.es/feed/" },
  // Investigación / corrupción / transparencia — confirma si exponen /feed
  { nombre: "Armando.info", url: "https://armando.info/feed/" },
  { nombre: "Transparencia Venezuela", url: "https://transparencia.org.ve/feed/" },
  // Derechos humanos / violencia — clave para el tema de colectivos
  { nombre: "PROVEA", url: "https://provea.org/feed/" },
  { nombre: "Foro Penal", url: "https://foropenal.com/feed/" },
];

// 2. Categorías de interés. Cada una es un grupo de palabras clave;
//    una noticia puede caer en varias a la vez (ej: "colectivos" + "ddhh").
//    Ajusta o amplía las listas según lo que veas que trae más ruido o
//    más señal en la práctica.
const CATEGORIAS: Record<string, string[]> = {
  conflicto_politico: [
    "oposición", "represión", "protesta", "detenido", "detención arbitraria",
    "preso político", "presos políticos", "exilio", "persecución política",
  ],
  colectivos_violencia: [
    "colectivo", "colectivos", "paramilitar", "asesinato", "ejecución extrajudicial",
    "masacre", "desaparición forzada", "fosas", "violencia armada",
  ],
  corrupcion: [
    "corrupción", "peculado", "malversación", "lavado de dinero", "soborno",
    "contrabando", "sobreprecio", "caso pdvsa", "narcotráfico",
  ],
  funcionarios_gobierno: [
    "nicolás maduro", "diosdado cabello", "delcy rodríguez", "cilia flores",
    "tareck el aissami", "vladimir padrino lópez", "tsj", "cne", "fiscalía general",
  ],
};

// Palabra clave general para confirmar que la nota es sobre Venezuela
// (evita, por ejemplo, "corrupción" de otro país)
const PALABRAS_PAIS = ["venezuela", "caracas", "miranda", "zulia", "táchira", "barinas"];

function clasificar(titulo: string, resumen: string): string[] {
  const texto = `${titulo} ${resumen}`.toLowerCase();
  const categorias: string[] = [];
  for (const [categoria, palabras] of Object.entries(CATEGORIAS)) {
    if (palabras.some((p) => texto.includes(p))) categorias.push(categoria);
  }
  return categorias;
}

function esRelevante(titulo: string, resumen: string): boolean {
  const texto = `${titulo} ${resumen}`.toLowerCase();
  const mencionaPais = PALABRAS_PAIS.some((p) => texto.includes(p));
  const tieneCategoria = clasificar(titulo, resumen).length > 0;
  // Si la fuente ya es 100% venezolana y de investigación/DD.HH.,
  // basta con que caiga en alguna categoría (no siempre dirán "Venezuela"
  // explícitamente en el titular). Si usas fuentes globales, exige ambas cosas:
  // return mencionaPais && tieneCategoria;
  return tieneCategoria || mencionaPais;
}

function hashDeUrl(url: string): string {
  return crypto.createHash("sha256").update(url.trim().toLowerCase()).digest("hex");
}

// Extrae la miniatura del ítem RSS. La mayoría de los medios exponen la
// imagen como <enclosure> o <media:content>; algunos solo la ponen dentro
// del HTML del <description>, así que ese caso queda como último recurso.
function extraerImagen(item: any): string | null {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item["media:content"]?.["$"]?.url) return item["media:content"]["$"].url;
  const match = item.content?.match(/<img[^>]+src="([^">]+)"/i);
  if (match) return match[1];
  return null;
}

export async function recolectarNoticias() {
  for (const fuente of FUENTES) {
    try {
      const feed = await parser.parseURL(fuente.url);

      for (const item of feed.items) {
        const titulo = item.title ?? "";
        const resumen = item.contentSnippet?.slice(0, 280) ?? "";
        const urlOriginal = item.link ?? "";
        if (!urlOriginal || !titulo) continue;

        // 3. Filtrar: solo lo relevante a conflicto político / colectivos / corrupción
        if (!esRelevante(titulo, resumen)) continue;
        const categorias = clasificar(titulo, resumen);

        const urlHash = hashDeUrl(urlOriginal);

        // 4. Deduplicar: si ya existe, no la vuelvas a insertar
        const yaExiste = await prisma.publicacion.findUnique({
          where: { url_hash: urlHash },
        });
        if (yaExiste) continue;

        // 5. Guardar como publicación de tipo "noticia_externa".
        //    Importante: guardamos SIEMPRE la fuente junto al texto, porque
        //    estas notas suelen incluir acusaciones graves (violencia, corrupción)
        //    que deben quedar atribuidas al medio que las reportó, no
        //    presentadas como un hecho confirmado por la plataforma.
        //
        //    Sobre la imagen: usamos la miniatura/enclosure que el propio medio
        //    incluye en su RSS para sindicación, y SIEMPRE con atribución y link
        //    de vuelta al artículo original — no descargamos ni republicamos
        //    fotos en alta resolución de los sitios de noticias, eso sí sería
        //    una violación de derechos de autor.
        const mediaUrl = extraerImagen(item);

        const nueva = await prisma.publicacion.create({
          data: {
            tipo: "noticia_externa",
            texto: titulo,
            resumen,
            url_original: urlOriginal,
            url_hash: urlHash,
            fuente: fuente.nombre,
            media_url: mediaUrl,
            categorias, // ej: ["colectivos_violencia", "conflicto_politico"]
            publicado_en: item.pubDate ? new Date(item.pubDate) : new Date(),
          },
        });

        // 6. Avisar al feed en tiempo real, igual que una publicación normal
        io.emit("publicacion:nueva", nueva);

        // 7. Si trae imagen, también la mandamos a Historias (24h) para que
        //    aparezca arriba, junto a las historias de los usuarios.
        if (mediaUrl) {
          const historia = await prisma.historia.create({
            data: {
              tipo: "noticia_externa",
              autor_nombre: fuente.nombre,
              media_url: mediaUrl,
              url_original: urlOriginal,
              publicacion_id: nueva.id,
              expira_en: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          });
          io.emit("historia:nueva", historia);
        }
      }
    } catch (err) {
      console.error(`Error leyendo la fuente ${fuente.nombre}:`, err);
      // No detengas el job completo si una sola fuente falla
    }
  }
}

/**
 * Programar el job cada 10 minutos, por ejemplo con node-cron:
 *
 *   import cron from "node-cron";
 *   cron.schedule("*\/10 * * * *", recolectarNoticias);
 *
 * O con BullMQ si ya usas colas para otras tareas del backend.
 */
