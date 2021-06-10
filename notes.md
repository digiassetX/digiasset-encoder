Changes in V3
    Multisig address option was only used once with opcode 2.  It would be best to extend op_return space instead.
    Opcodes: 3,4 where never used they have been reassigned
    Opcode 1: SHA1 has been removed to save space since it is not used

    percent and range features where implemented



    Opcode 3: after sha2 hash rules.  If unlocked rules can be changed:
    Opcode 4: same as 2 except rules can never be changed again


rule types:
0:  signatures
1:  royalties
9:  exchange rate based royalty
2:  kyc allow
3:  kyc ban
4:  vote
5:  deflate - must use a burn op code for each transfer
6-8,10-13: not yet defined
15: done    if rules is not a full byte at this point pad with 1s

