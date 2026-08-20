import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import { saveAs } from 'file-saver';

/**
 * 1. IZVOZ POJEDINAČNOG ODGOVORA (Npr. generisani pravni akt)
 */
export async function exportSingleMessageToWord(content: string, filename = 'Pravni_Akt') {
  // Delimo tekst po novim redovima kako bi u Wordu svaki pasus bio odvojen
  const paragraphs = content.split('\n').map((line) => {
    return new Paragraph({
      alignment: AlignmentType.BOTH, 
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: line,
          font: 'Times New Roman',
          size: 24, // 24 polutačke = 12pt font
          color: '000000',
        }),
      ],
    });
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: paragraphs,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const date = new Date().toISOString().slice(0, 10); // Formatira današnji datum
  saveAs(blob, `${filename}_${date}.docx`);
}

/**
 * 2. IZVOZ CELOG RAZGOVORA (Sva pitanja i odgovori iz sesije)
 */
export async function exportFullChatToWord(
  messages: { role: string; content: string }[],
  chatTitle = 'Zapisnik_Razgovora'
) {
  const docElements: Paragraph[] = [
    // Glavni naslov dokumenta
    new Paragraph({
      text: `Zapisnik razgovora: ${chatTitle}`,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
  ];

  messages.forEach((msg) => {
    const isUser = msg.role === 'user';
    
    // Zaglavlje za to ko govori (Korisnik / Pravni Asistent)
    docElements.push(
      new Paragraph({
        spacing: { before: 240, after: 120 },
        children: [
          new TextRun({
            text: isUser ? 'PITANJE (Korisnik):' : 'ODGOVOR (Pravni Asistent):',
            bold: true,
            font: 'Times New Roman',
            size: 24,
            color: isUser ? '16263D' : '0F52BA', // Asistent ima blago plavu boju naslova za lakše prepoznavanje
          }),
        ],
      })
    );

    // Sadržaj same poruke
    const lines = msg.content.split('\n');
    lines.forEach((line) => {
      if (line.trim() !== '') { // Preskačemo prazne linije da dokument bude uredniji
        docElements.push(
          new Paragraph({
            alignment: AlignmentType.BOTH, // Zamenjeno JUSTIFY sa BOTH
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: line,
                font: 'Times New Roman',
                size: 24,
                color: '000000',
              }),
            ],
          })
        );
      }
    });
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: docElements,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  // Pravimo bezbedno ime fajla (bez razmaka i čudnih karaktera)
  const safeTitle = chatTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const date = new Date().toISOString().slice(0, 10);
  saveAs(blob, `${safeTitle}_zapisnik_${date}.docx`);
}