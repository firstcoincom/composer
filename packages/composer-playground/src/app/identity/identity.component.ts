import { Component, OnInit } from '@angular/core';

import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { DeleteComponent } from '../basic-modals/delete-confirm/delete-confirm.component';

import { IssueIdentityComponent } from './issue-identity';
import { IdentityIssuedComponent } from './identity-issued';
import { AlertService } from '../basic-modals/alert.service';
import { ClientService } from '../services/client.service';
import { IdentityCardService } from '../services/identity-card.service';
import { IdCard } from 'composer-common';

@Component({
    selector: 'identity',
    templateUrl: './identity.component.html',
    styleUrls: [
        './identity.component.scss'.toString()
    ]
})
export class IdentityComponent implements OnInit {

    private identityCards: Map<string, IdCard>;
    private cardRefs: string[];
    private allIdentities: Object[]; // array of all IDs
    private currentIdentity: string = null;
    private businessNetworkName;

    constructor(private modalService: NgbModal,
                private alertService: AlertService,
                private clientService: ClientService,
                private identityCardService: IdentityCardService) {

    }

    ngOnInit(): Promise<any> {
        return this.loadAllIdentities();
    }

    loadAllIdentities(): Promise<void> {
        this.loadMyIdentities();
        return this.clientService.ensureConnected()
            .then(() => {
                this.businessNetworkName = this.clientService.getMetaData().getName();
                return this.clientService.getBusinessNetworkConnection().getIdentityRegistry();
            }).then((registry) => {
                return registry.getAll();
            }).then((ids) => {
                // get the card ref for each identity
                let connectionProfile = this.identityCardService.getCurrentIdentityCard().getConnectionProfile();
                let qpn: string = this.identityCardService.getQualifiedProfileName(connectionProfile);

                ids.sort((a, b) => {
                    return a.name.localeCompare(b.name);
                });

                ids.forEach((id) => {
                    id.ref = this.identityCardService.getCardRefFromIdentity(id.name, this.businessNetworkName, qpn);
                });

                this.allIdentities = ids;
            })
            .catch((error) => {
                this.alertService.errorStatus$.next(error);
            });
    }

    loadMyIdentities(): void {
        this.currentIdentity = this.identityCardService.currentCard;

        let businessNetwork = this.identityCardService.getCurrentIdentityCard().getBusinessNetworkName();
        let connectionProfile = this.identityCardService.getCurrentIdentityCard().getConnectionProfile();
        let qpn = this.identityCardService.getQualifiedProfileName(connectionProfile);

        this.identityCards = this.identityCardService.getAllCardsForBusinessNetwork(businessNetwork, qpn);

        this.cardRefs = Array.from(this.identityCards.keys());
    }

    issueNewId(): Promise<void> {
        return this.modalService.open(IssueIdentityComponent).result.then((result) => {
            if (result) {
                const modalRef = this.modalService.open(IdentityIssuedComponent);
                modalRef.componentInstance.userID = result.userID;
                modalRef.componentInstance.userSecret = result.userSecret;

                return modalRef.result;
            }
        }, (reason) => {
            if (reason && reason !== 1) { // someone hasn't pressed escape
                this.alertService.errorStatus$.next(reason);
            }
        })
            .then(() => {
                return this.loadAllIdentities();
            }, (reason) => {
                this.alertService.errorStatus$.next(reason);
            });
    }

    setCurrentIdentity(cardRef: string): Promise<void> {
        if (this.currentIdentity === cardRef) {
            return Promise.resolve();
        }

        this.identityCardService.setCurrentIdentityCard(cardRef)
            .then(() => {
                this.currentIdentity = cardRef;
                this.alertService.busyStatus$.next({
                    title: 'Reconnecting...',
                    text: 'Using identity ' + this.currentIdentity
                });
                return this.clientService.ensureConnected(null, true);
            })
            .then(() => {
                this.alertService.busyStatus$.next(null);
                return this.loadAllIdentities();
            })
            .catch((error) => {
                this.alertService.busyStatus$.next(null);
                this.alertService.errorStatus$.next(error);
            });
    }

    removeIdentity(cardRef: string): Promise<void> {

        let userID = this.identityCards.get(cardRef).getName();

        // show confirm/delete dialog first before taking action
        const confirmModalRef = this.modalService.open(DeleteComponent);
        confirmModalRef.componentInstance.headerMessage = 'Remove ID';
        confirmModalRef.componentInstance.fileAction = 'remove';
        confirmModalRef.componentInstance.fileType = 'ID';
        confirmModalRef.componentInstance.fileName = userID;
        confirmModalRef.componentInstance.deleteMessage = 'Take care when removing IDs: you usually cannot re-add them. Make sure you leave at least one ID that can be used to issue new IDs.';
        confirmModalRef.componentInstance.confirmButtonText = 'Remove';

        return confirmModalRef.result
            .then((result) => {
                if (result) {
                    this.alertService.busyStatus$.next({
                        title: 'Removing ID',
                        text: 'Removing identity ' + userID + ' from your wallet'
                    });

                    return this.identityCardService.deleteIdentityCard(cardRef)
                        .then(() => {
                            return this.loadAllIdentities();
                        })
                        .then(() => {
                            // Send alert
                            this.alertService.busyStatus$.next(null);
                            this.alertService.successStatus$.next({
                                title: 'Removal Successful',
                                text: userID + ' was successfully removed.',
                                icon: '#icon-trash_32'
                            });
                        })
                        .catch((error) => {
                            this.alertService.errorStatus$.next(error);
                        });
                }
            }, (reason) => {
                // runs this when user presses 'cancel' button on the modal
                if (reason && reason !== 1) {
                    this.alertService.busyStatus$.next(null);
                    this.alertService.errorStatus$.next(reason);
                }
            });
    }

    revokeIdentity(identity): Promise<void> {
        // show confirm/delete dialog first before taking action
        const confirmModalRef = this.modalService.open(DeleteComponent);
        confirmModalRef.componentInstance.headerMessage = 'Revoke Identity';
        confirmModalRef.componentInstance.fileAction = 'revoke the permissions for';
        confirmModalRef.componentInstance.fileType = 'identity';
        confirmModalRef.componentInstance.fileName = identity.name;
        confirmModalRef.componentInstance.deleteMessage = 'Are you sure you want to do this?';
        confirmModalRef.componentInstance.confirmButtonText = 'Revoke';
        confirmModalRef.componentInstance.action = 'revoke';

        return confirmModalRef.result
            .then((result) => {
                if (result) {
                    this.alertService.busyStatus$.next({
                        title: 'Revoking identity within business network',
                        text: 'Revoking identity ' + identity.name
                    });

                    return this.clientService.revokeIdentity(identity)
                        .then(() => {
                            // only try and remove it if its in the wallet
                            let walletIdentity = this.cardRefs.find((myIdentity) => {
                                return identity.ref === myIdentity;
                            });

                            if (walletIdentity) {
                                return this.removeIdentity(identity.ref);
                            }
                        })
                        .then(() => {
                            return this.loadAllIdentities();
                        })
                        .then(() => {
                            // Send alert
                            this.alertService.busyStatus$.next(null);
                            this.alertService.successStatus$.next({
                                title: 'Revoke Successful',
                                text: identity.name + ' was successfully revoked.',
                                icon: '#icon-trash_32'
                            });
                        })
                        .catch((error) => {
                            this.alertService.busyStatus$.next(null);
                            this.alertService.errorStatus$.next(error);
                        });
                }
            }, (reason) => {
                // runs this when user presses 'cancel' button on the modal
                if (reason && reason !== 1) {
                    this.alertService.busyStatus$.next(null);
                    this.alertService.errorStatus$.next(reason);
                }
            });
    }
}
