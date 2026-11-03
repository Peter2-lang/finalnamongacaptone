import { db } from './index.ts';
import { messages } from './schema.ts';
import { eq, desc } from 'drizzle-orm';
import { MessageItem } from '../types.ts';

export function mapDbToMessage(row: any): MessageItem {
  const metadata = row.attachments && !Array.isArray(row.attachments) ? row.attachments : {};
  return {
    id: String(row.id),
    senderId: row.senderId,
    senderName: row.senderName,
    senderRole: row.senderRole as any,
    targetBarangay: row.barangay || 'all',
    recipientBarangay: row.barangay || 'all',
    recipientId: row.receiverId || undefined,
    title: metadata.subject || (row.text ? row.text.substring(0, 40) : 'Official Advisory'),
    subject: metadata.subject || (row.text ? row.text.substring(0, 40) : 'Official Advisory'),
    content: row.text,
    body: row.text,
    priority: ['normal','advisory','urgent'].includes(metadata.priority) ? metadata.priority : 'normal',
    isRead: Boolean(row.isRead),
    attachments: Array.isArray(row.attachments) ? row.attachments : Array.isArray(metadata.files) ? metadata.files : [],
    timestamp: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
  };
}

export async function getAllMessages(filter?: { role?: string; barangay?: string; userId?: string }): Promise<MessageItem[]> {
  try {
    const rows = await db.select().from(messages).orderBy(desc(messages.createdAt));
    let list = rows.map(mapDbToMessage);

    if (filter?.role && filter.role !== 'admin' && filter.role !== 'super_admin') {
      list = list.filter(m => {
        if (m.recipientId) return m.recipientId === filter.userId || m.senderId === filter.userId;
        if (m.targetBarangay === 'all') return true;
        if (filter.barangay && m.targetBarangay && m.targetBarangay.toLowerCase() === filter.barangay.toLowerCase()) return true;
        if (filter.userId && (m.senderId === filter.userId || m.recipientId === filter.userId)) return true;
        return false;
      });
    }

    return list;
  } catch (err) {
    throw new Error('Unable to retrieve messages from the database.', { cause: err });
  }
}

export async function createMessage(msg: Partial<MessageItem> & Record<string, any>): Promise<MessageItem> {
  try {
    const id = msg.id || `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const textContent = msg.content || msg.body || msg.message || msg.title || '';
    const targetBrgy = msg.targetBarangay || msg.recipientBarangay || msg.barangay || 'all';

    const values = {
      id,
      senderId: msg.senderId || 'user',
      senderName: msg.senderName || 'Anonymous',
      senderRole: (msg.senderRole || 'focal') as string,
      receiverId: msg.recipientId || msg.receiverId || null,
      receiverRole: msg.recipientRole || null,
      barangay: targetBrgy !== 'all' ? targetBrgy : null,
      text: textContent,
      attachments: {files: Array.isArray(msg.attachments) ? msg.attachments : [], subject: msg.subject || msg.title || '', priority: msg.priority || 'normal'},
      isRead: false,
    };

    const result = await db.insert(messages).values(values).onConflictDoNothing().returning();
    if (result[0]) return mapDbToMessage(result[0]);
    const existing = await db.select().from(messages).where(eq(messages.id, id));
    if (!existing[0] || existing[0].senderId !== values.senderId) throw new Error('Message ID conflict.');
    return mapDbToMessage(existing[0]);
  } catch (err) {
    console.error('Database query error in createMessage:', err);
    throw new Error('Failed to send message to database.');
  }
}

export async function markMessageRead(id: string): Promise<boolean> {
  try {
    await db.update(messages).set({ isRead: true }).where(eq(messages.id, id));
    return true;
  } catch (err) {
    console.error('Database query error in markMessageRead:', err);
    return false;
  }
}

export async function deleteMessageById(id: string): Promise<boolean> {
  try {
    await db.delete(messages).where(eq(messages.id, id));
    return true;
  } catch (err) {
    console.error('Database query error in deleteMessageById:', err);
    return false;
  }
}
