import {createFencedSupportDocumentConsumer} from './fencedSupportDocumentConsumer.js';

/**
 * Optional ManagedReviewDocuments.fencedSupportConsume adapter.
 * Normal document integrity, readiness, tenant reading, audit and per-phase
 * permissions still execute before the final protected consumption.
 */
export function createFencedReviewDocumentConsume({resolveBinding,transferFence}={}){
  if(typeof resolveBinding!=='function'||typeof transferFence!=='function')
    throw new Error('SUPPORT_REVIEW_DOCUMENT_FENCE_CONFIGURATION_INVALID');
  return async function fencedConsume(context,document,consume){
    if(typeof consume!=='function')throw new Error('SUPPORT_REVIEW_DOCUMENT_FENCE_UNAVAILABLE');
    return createFencedSupportDocumentConsumer({resolveBinding,transferFence,consume})(context,document);
  };
}
